#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs } from './lib/config-loader.mjs';
import { loadApplications, repairMojibakeText, selectApplications } from './lib/applications-store.mjs';
import { loadEmailConfig, assertEmailPolicy, emailPolicySummary, validateEmailConfig } from './lib/email/email-policy.mjs';
import { loadEmailDrafts, upsertEmailDrafts } from './lib/email/email-draft-store.mjs';
import { selectCvForApplication } from './lib/cv-selector.mjs';
import { normalizeText, normalizeWhitespace, slugify, todayISO } from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export function buildLocalEmailDrafts(options = {}) {
  const root = options.projectRoot || projectRoot;
  const configs = loadJobFinderConfigs(root);
  const emailConfig = loadEmailConfig(root);
  const validation = assertEmailPolicy(emailConfig);

  if (options.checkPolicy) {
    return {
      dry_run: true,
      check_policy: true,
      validation,
      policy: emailPolicySummary(emailConfig),
      selected: [],
    };
  }

  const applications = selectApplications(loadApplications(root), options);
  const existing = loadEmailDrafts(root, emailConfig);
  const outputDir = resolve(root, options.outputDir || emailConfig.drafts?.local_output_dir || join('output', 'email-drafts-local'));
  const records = [];
  const selected = [];

  for (const application of applications) {
    const reportPath = resolve(root, application.report_path || '');
    const report = existsSync(reportPath) ? repairMojibakeText(readFileSync(reportPath, 'utf-8')) : '';
    const sections = extractSections(report);
    const draftSection = sectionOrFallback(sections, ['Rascunho De Email', 'Rascunho de Email', 'Email Draft'], '');
    const parsed = parseEmailDraft(draftSection, application, emailConfig);
    const to = normalizeWhitespace(options.to || emailConfig.drafts?.default_to || 'a confirmar');
    const attachment = plannedCvAttachment(root, configs, emailConfig, application, report);
    const plannedAttachment = attachment.path;
    const vacancyVerification = verifyVacancy(application, emailConfig);
    const status = draftStatus({
      to,
      parsed,
      report,
      attachmentExists: existsSync(plannedAttachment),
      vacancyVerification,
      emailConfig,
    });
    const output = join(outputDir, `${String(application.id).padStart(3, '0')}-${slugify(application.company)}-${slugify(application.role)}.md`);
    const bodyFile = relativePath(root, output);
    const markdown = renderLocalDraft({
      application,
      parsed,
      to,
      status,
      plannedAttachment,
      reportPath: application.report_path,
      emailConfig,
      cvSelection: attachment.selection,
      vacancyVerification,
      root,
    });
    const current = existing.get(application.report_number);
    const record = {
      id: current?.id || '',
      application_id: String(application.id),
      report_number: application.report_number,
      company: application.company,
      role: application.role,
      status,
      provider: emailConfig.provider || 'gmail',
      to,
      subject: parsed.subject,
      body_file: bodyFile,
      planned_attachment: relativePath(root, plannedAttachment),
      gmail_draft_id: current?.gmail_draft_id || '',
      created_at: current?.created_at || todayISO(),
      updated_at: todayISO(),
      review_required: 'yes',
      quality_gate_status: emailConfig.safety?.require_draft_quality_gate ? 'run_draft_quality_before_use' : 'not_required_by_config',
      notes: localDraftNotes(status),
    };

    records.push(record);
    selected.push({
      application,
      record,
      output,
      markdown,
    });

    if (!options.dryRun) {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(output, markdown, 'utf-8');
    }
  }

  if (!options.dryRun) {
    upsertEmailDrafts(root, records, emailConfig);
  }

  return {
    dry_run: Boolean(options.dryRun),
    policy: emailPolicySummary(emailConfig),
    validation,
    total_applications: applications.length,
    selected,
    output_dir: outputDir,
    store: resolve(root, emailConfig.drafts?.store || 'data/email-drafts.tsv'),
  };
}

function plannedCvAttachment(root, configs, emailConfig, application, report) {
  const selection = selectCvForApplication({
    application,
    report,
    profile: configs.profile,
    projectRoot: root,
    dryRun: true,
  });
  const selectedOutput = resolve(root, selection.selected_cv_pdf || '');
  const selectedSource = resolve(root, selection.source_cv_pdf || '');
  if (selection.selected_cv_pdf && existsSync(selectedOutput)) {
    return { path: selectedOutput, selection };
  }
  if (selection.source_cv_pdf && existsSync(selectedSource)) {
    return { path: selectedSource, selection };
  }
  const fromEmail = emailConfig.attachments?.planned_cv_pdf || '';
  const fromProfile = configs.profile?.documents?.current_cv_pdf || '';
  return {
    path: resolve(root, fromEmail || fromProfile || 'output/CV-Candidate.pdf'),
    selection,
  };
}

function extractSections(report) {
  const sections = {};
  if (!report) return sections;
  const matches = [...report.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const title = normalizeWhitespace(match[1]);
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : report.length;
    sections[title] = report.slice(start, end).trim();
  }
  return sections;
}

function sectionOrFallback(sections, names, fallback) {
  for (const name of names) {
    if (sections[name]) return sections[name];
  }
  return fallback;
}

function parseEmailDraft(section, application, emailConfig) {
  const lines = String(section || '').replace(/\r\n/g, '\n').split('\n');
  let subject = '';
  const bodyLines = [];
  for (const line of lines) {
    const subjectMatch = line.match(/^\s*(Assunto|Subject)\s*:\s*(.+?)\s*$/i);
    if (!subject && subjectMatch) {
      subject = normalizeWhitespace(subjectMatch[2]);
      continue;
    }
    bodyLines.push(line);
  }

  if (!subject) {
    subject = `${emailConfig.drafts?.subject_prefix || 'Candidatura'} - ${application.role}`;
  }

  return {
    subject: sanitizePrivateProjectName(repairMojibakeText(subject)),
    body: sanitizePrivateProjectName(repairMojibakeText(bodyLines.join('\n').trim())),
  };
}

function draftStatus({ to, parsed, report, attachmentExists, vacancyVerification, emailConfig }) {
  if (!parsed.body || normalizeText(parsed.body) === 'a confirmar') return 'blocked_missing_draft';
  if (!report) return 'blocked_missing_report';
  if (!attachmentExists) return 'blocked_missing_cv';
  if (emailConfig.safety?.require_vacancy_verified && !vacancyVerification.ok) {
    return 'blocked_unverified_vacancy';
  }
  if (!to || normalizeText(to) === 'a confirmar') return 'needs_recipient';
  return 'local_ready';
}

function localDraftNotes(status) {
  if (status === 'needs_recipient') return 'Local draft only; confirm recruiter/company email before Gmail draft.';
  if (status === 'blocked_missing_draft') return 'Report has no usable email draft.';
  if (status === 'blocked_missing_report') return 'Report file missing; regenerate or repair report link.';
  if (status === 'blocked_missing_cv') return 'Selected CV is missing; repair the CV library before use.';
  if (status === 'blocked_unverified_vacancy') return 'Open the official vacancy and add a recent [verified:YYYY-MM-DD] tracker marker.';
  return 'Local draft only; review pack and draft quality before Gmail draft.';
}

function renderLocalDraft({ application, parsed, to, status, plannedAttachment, reportPath, emailConfig, cvSelection, vacancyVerification, root }) {
  return `# Local Email Draft - ${application.company} - ${application.role}

Generated: ${todayISO()}
Application ID: ${String(application.id).padStart(3, '0')}
Report: ${reportPath || 'a confirmar'}
Status: ${status}
Provider target: ${emailConfig.provider || 'gmail'}
Human review required: yes

This is a local preparation artifact. It does not create a Gmail draft, does not send email and does not upload a CV.

## Safety

- Do not send automatically.
- Do not upload CV automatically.
- Confirm recipient before creating a Gmail draft.
- Run \`npm.cmd run draft-quality\` before using this draft.
- Keep uncertain details as \`a confirmar\`.

## Envelope

To: ${to || 'a confirmar'}
Subject: ${parsed.subject || 'a confirmar'}
Planned attachment: ${relativePath(root, plannedAttachment) || 'a confirmar'}
CV preselection: ${cvSelection?.language_label || 'a confirmar'} / ${cvSelection?.variant_label || 'a confirmar'}
CV selection reason: ${cvSelection?.variant_reason || 'a confirmar'}
Vacancy verification: ${vacancyVerification.ok ? `verified ${vacancyVerification.date}` : vacancyVerification.reason}
Attachment approval: ${emailConfig.attachments?.require_explicit_attachment_approval ? 'required' : 'a confirmar'}

## Body

${parsed.body || 'a confirmar'}
`;
}

function relativePath(root, file) {
  return String(file || '')
    .replace(`${root}\\`, '')
    .replace(`${root}/`, '')
    .replace(/\\/g, '/');
}

function sanitizePrivateProjectName(value) {
  return String(value || '').replace(/\b(?:wairvis|warvis)\b/gi, 'Lurien');
}

function verifyVacancy(application, emailConfig) {
  if (!emailConfig.safety?.require_vacancy_verified) {
    return { ok: true, date: '', reason: 'not required by policy' };
  }
  const match = String(application.notes || '').match(/\[verified:(\d{4}-\d{2}-\d{2})\]/i);
  if (!match) {
    return { ok: false, date: '', reason: 'missing [verified:YYYY-MM-DD] tracker marker' };
  }
  const date = match[1];
  const verifiedAt = new Date(`${date}T00:00:00Z`);
  const today = new Date(`${todayISO()}T00:00:00Z`);
  const ageDays = Math.floor((today - verifiedAt) / 86400000);
  const maxAge = Number(emailConfig.safety?.vacancy_verification_max_age_days ?? 7);
  if (!Number.isFinite(verifiedAt.getTime()) || ageDays < 0) {
    return { ok: false, date, reason: 'invalid or future vacancy verification date' };
  }
  if (ageDays > maxAge) {
    return { ok: false, date, reason: `vacancy verification is ${ageDays} days old; maximum is ${maxAge}` };
  }
  return { ok: true, date, reason: `verified ${ageDays} days ago` };
}

function privateProjectNamePattern() {
  const confirmedName = ['w', 'ar', 'vis'].join('');
  const misspelledName = ['w', 'air', 'vis'].join('');
  return new RegExp(`\\b(?:${escapeRegExp(confirmedName)}|${escapeRegExp(misspelledName)})\\b`, 'gi');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    checkPolicy: false,
    id: '',
    top: 10,
    minScore: 70,
    outputDir: '',
    to: '',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--check-policy') options.checkPolicy = true;
    else if (arg === '--id') options.id = argv[++index] || '';
    else if (arg === '--top') options.top = Number(argv[++index] || options.top);
    else if (arg === '--min-score') options.minScore = Number(argv[++index] || options.minScore);
    else if (arg === '--out') options.outputDir = argv[++index] || '';
    else if (arg === '--to') options.to = argv[++index] || '';
  }
  return options;
}

function printResult(result) {
  if (result.check_policy) {
    const validation = validateEmailConfig(loadEmailConfig(projectRoot));
    console.log('Email policy');
    console.log('============');
    console.log(`OK: ${validation.ok ? 'yes' : 'no'}`);
    for (const warning of validation.warnings) console.log(`Warning: ${warning}`);
    for (const error of validation.errors) console.log(`Error: ${error}`);
    console.log(`Mode: ${result.policy.mode}`);
    console.log(`Auto-send: ${result.policy.auto_send ? 'yes' : 'no'}`);
    console.log(`Real Gmail drafts: ${result.policy.real_gmail_drafts ? 'yes' : 'no'}`);
    return;
  }

  console.log(`Local email drafts: ${result.selected.length}/${result.total_applications} selected.`);
  if (result.dry_run) console.log('Dry-run: no local draft files or TSV rows were written.');
  else {
    console.log(`Output: ${relativePath(projectRoot, result.output_dir)}`);
    console.log(`Store: ${relativePath(projectRoot, result.store)}`);
  }
  for (const item of result.selected) {
    console.log(`- #${String(item.application.id).padStart(3, '0')} ${item.record.status} ${item.application.company} | ${item.record.subject}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  printResult(buildLocalEmailDrafts(parseArgs(process.argv.slice(2))));
}
