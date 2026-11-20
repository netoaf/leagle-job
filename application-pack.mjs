#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs } from './lib/config-loader.mjs';
import { loadApplications, selectApplications } from './lib/applications-store.mjs';
import { selectCvForApplication } from './lib/cv-selector.mjs';
import { normalizeText, normalizeWhitespace, slugify, todayISO } from './lib/job-normalizer.mjs';
import { applicationFacingRole } from './scan-and-rank.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOP = 10;
const DEFAULT_MIN_SCORE = 70;

export function buildApplicationPacks(options = {}) {
  const root = options.projectRoot || projectRoot;
  const configs = loadJobFinderConfigs(root);
  const applications = loadApplications(root);
  const selected = selectApplications(applications, options);
  const outputDir = resolve(root, options.outputDir || join('output', 'application-packs'));
  const results = [];

  for (const application of selected) {
    const reportPath = resolve(root, application.report_path || '');
    const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
    const cvSelection = selectCvForApplication({
      application,
      report,
      profile: configs.profile,
      projectRoot: root,
      outputDir: join(outputDir, 'cvs'),
      dryRun: options.dryRun,
    });
    const pack = buildPackMarkdown(application, report, configs, cvSelection);
    const fileName = `${String(application.id).padStart(3, '0')}-${slugify(repairMojibakeText(application.company))}-${slugify(repairMojibakeText(application.role))}.md`;
    const outputPath = join(outputDir, fileName);

    results.push({
      id: application.id,
      company: application.company,
      role: application.role,
      score: application.score_number,
      report: application.report_path,
      output: outputPath,
      selected_cv: cvSelection.selected_cv_pdf,
      cv_language: cvSelection.language,
      cv_variant: cvSelection.variant,
      cv_status: cvSelection.status,
      pack,
    });

    if (!options.dryRun) {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(outputPath, pack, 'utf-8');
    }
  }

  return {
    dry_run: Boolean(options.dryRun),
    total_applications: applications.length,
    selected: results,
    output_dir: outputDir,
  };
}

function buildPackMarkdown(application, report, configs, cvSelection) {
  const profile = configs.profile || {};
  const rules = configs.rules || {};
  const candidateContext = configs.candidate_context || {};
  const cleanReport = repairMojibakeText(report);
  const company = repairMojibakeText(application.company);
  const role = repairMojibakeText(application.role);
  const status = repairMojibakeText(application.status);
  const selectedCvPdf = cvSelection.selected_cv_pdf || '';
  const evidenceBank = profile.documents?.evidence_bank || 'data/candidate-evidence.md';
  const sections = extractReportSections(cleanReport);
  const redFlags = sectionOrFallback(sections, ['Red Flags', 'Red flags'], '- a confirmar');
  const hardBlockers = sectionOrFallback(sections, ['Hard Blockers', 'Hard blockers'], '- a confirmar');
  const cvAdjustments = sanitizePrivateProjectName(sectionOrFallback(sections, ['CV Adjustments'], '- Manter posicionamento junior/estagio.\n- Nao inventar dados.'));
  const rawEmailDraft = sanitizePrivateProjectName(sectionOrFallback(sections, ['Rascunho De Email', 'Rascunho de Email', 'Email Draft'], 'a confirmar'));
  const targetedRole = applicationFacingRole({ title: role, description: cleanReport });
  const emailDraft = targetedRole === role ? rawEmailDraft : rawEmailDraft.split(role).join(targetedRole);
  const nextAction = sectionOrFallback(sections, ['Next Action'], 'Rever manualmente antes de enviar.');
  const applicationChannel = extractApplicationChannel(application.notes);
  const confirmations = buildConfirmationList(cleanReport, application);
  const privacyRules = asArray(rules.privacy?.deny).slice(0, 8);

  return `# Application Pack - ${company} - ${role}

**Generated:** ${todayISO()}
**Application ID:** ${String(application.id).padStart(3, '0')}
**Company:** ${company}
**Role:** ${role}
**Score:** ${application.score}
**Status:** ${status}
**Application Channel:** ${applicationChannel}
**Report:** ${application.report_path || 'a confirmar'}
**Selected CV PDF:** ${selectedCvPdf || 'a confirmar'} (${cvSelection.status})
**CV preselection:** ${cvSelection.language_label} / ${cvSelection.variant_label}
**Pack Status:** Needs human review

## Decision

- Recommendation: prepare application, then review manually.
- Do not send automatically.
- Do not upload CV automatically.
- Do not submit forms automatically.
- Confirm that the selected language and variant match the vacancy.
- Use this pack to prepare the application, not as proof that it was sent.

## Files To Review

- Selected CV PDF: ${selectedCvPdf || 'a confirmar'}
- CV library source: ${cvSelection.source_cv_pdf || 'a confirmar'}
- Rule-based preliminary choice: ${cvSelection.language_label} / ${cvSelection.variant_label}
- Language reason: ${cvSelection.language_reason}
- Variant reason: ${cvSelection.variant_reason}
- Source report: ${application.report_path || 'a confirmar'}
- Evidence bank: ${evidenceBank}
- Tracker row: data/applications.md #${application.id}

## Safe Candidate Evidence

${buildEvidenceSummary(candidateContext)}

## Confirm Before Sending

${bulletList(confirmations)}

## CV Adjustments

${cvAdjustments.trim()}

## Email Draft

${emailDraft.trim()}

## Recruiter Questions

${buildRecruiterQuestions(confirmations)}

## Red Flags

${redFlags.trim()}

## Hard Blockers

${hardBlockers.trim()}

## Privacy Checklist

- Use only confirmed profile data.
- Do not include private code, private links, API keys, tokens or sensitive data.
- Private projects can only be presented through controlled demo, screenshots or technical description.
- Never invent experience, projects, certificates, metrics, links, clients or results.
${privacyRules.length ? privacyRules.map((item) => `- Do not include: ${item}.`).join('\n') : '- No extra privacy deny-list loaded.'}

## Follow-Up Plan

- If applied manually, update data/applications.md status to Applied.
- Add applied date and next action when follow-up tracking is implemented.
- Suggested first follow-up: 7 calendar days after manual application, unless the company gives another timeline.

## Next Action

${nextAction.trim()}
`;
}

function extractApplicationChannel(notes = '') {
  const marker = String(notes).match(/\[channel:([a-z0-9_-]+)\]/i);
  return marker?.[1] || 'unknown';
}

function extractReportSections(report) {
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
    if (sections[name]) return sanitizePrivateProjectName(repairMojibakeText(sections[name]));
  }
  return sanitizePrivateProjectName(fallback);
}

function buildConfirmationList(report, application) {
  const confirmations = new Set();
  const text = normalizeText(repairMojibakeText(`${application.notes}\n${report}`));

  if (text.includes('remuneracao') || text.includes('bolsa') || text.includes('compensation') || text.includes('salary')) {
    confirmations.add('Confirmar remuneracao/bolsa quando nao estiver explicita.');
  }
  if (text.includes('regime') || text.includes('remote') || text.includes('hibrido') || text.includes('hybrid') || text.includes('onsite')) {
    confirmations.add('Confirmar regime de trabalho e localizacao real.');
  }
  if (text.includes('licenciatura') || text.includes('degree') || text.includes('bachelor') || text.includes('iefp')) {
    confirmations.add('Confirmar elegibilidade com TGPSI/finalista e requisitos IEFP/formacao.');
  }
  if (text.includes('english') || text.includes('ingles') || text.includes('language')) {
    confirmations.add('Confirmar requisito de lingua se a vaga exigir nivel especifico.');
  }
  if (text.includes('a confirmar')) {
    confirmations.add('Resolver todos os pontos marcados como a confirmar no report.');
  }

  confirmations.add('Rever o email e o CV antes de enviar.');
  confirmations.add('Obter aprovacao humana explicita antes de submeter candidatura.');
  return [...confirmations];
}

function buildRecruiterQuestions(confirmations) {
  const questions = [];
  const text = normalizeText(confirmations.join(' '));

  if (text.includes('remuneracao') || text.includes('bolsa')) {
    questions.push('Podem confirmar se a oportunidade inclui bolsa/remuneracao e qual o intervalo previsto?');
  }
  if (text.includes('regime') || text.includes('localizacao')) {
    questions.push('Podem confirmar se o regime e remoto, hibrido ou presencial e qual a localizacao esperada?');
  }
  if (text.includes('elegibilidade') || text.includes('iefp') || text.includes('tgpsi')) {
    questions.push('O meu perfil de finalista TGPSI e elegivel para esta oportunidade/estagio?');
  }
  if (questions.length === 0) {
    questions.push('Ha algum requisito obrigatorio que deva confirmar antes de submeter a candidatura?');
  }
  return questions.map((question) => `- ${question}`).join('\n');
}

function buildEvidenceSummary(candidateContext) {
  const positioning = repairMojibakeText(candidateContext.positioning?.primary_identity || 'Junior/intern candidate with practical project evidence.');
  const projects = asArray(candidateContext.projects)
    .map((project) => `- ${repairMojibakeText(project.name)}: ${repairMojibakeText(project.safe_description || project.summary || 'a confirmar')}`)
    .slice(0, 4);
  const forbidden = asArray(candidateContext.positioning?.avoid_positioning)
    .map((item) => `- Do not position as: ${repairMojibakeText(item)}.`)
    .slice(0, 6);

  return [
    `- Positioning: ${positioning}`,
    ...projects,
    ...forbidden,
  ].join('\n');
}

function sanitizePrivateProjectName(value) {
  return String(value || '').replace(/\b(?:wairvis|warvis)\b/gi, 'Lurien');
}

function privateProjectNamePattern() {
  const confirmedName = ['w', 'ar', 'vis'].join('');
  const misspelledName = ['w', 'air', 'vis'].join('');
  return new RegExp(`\\b(?:${escapeRegExp(confirmedName)}|${escapeRegExp(misspelledName)})\\b`, 'gi');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bulletList(values) {
  const clean = values.map((value) => normalizeWhitespace(repairMojibakeText(value))).filter(Boolean);
  if (clean.length === 0) return '- a confirmar';
  return clean.map((value) => `- ${value}`).join('\n');
}

function repairMojibakeText(value) {
  const text = String(value ?? '');
  if (!/[\u00c3\u00c2\u00e2]/.test(text)) return text;

  const repaired = Buffer.from(text, 'latin1').toString('utf8');
  return mojibakeScore(repaired) < mojibakeScore(text) ? repaired : text;
}

function mojibakeScore(text) {
  return (String(text || '').match(/[\u00c3\u00c2\u00e2\ufffd]/g) || []).length;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    id: '',
    top: DEFAULT_TOP,
    minScore: DEFAULT_MIN_SCORE,
    outputDir: '',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--id') options.id = argv[++index] || '';
    else if (arg === '--top') options.top = Number(argv[++index] || options.top);
    else if (arg === '--min-score') options.minScore = Number(argv[++index] || options.minScore);
    else if (arg === '--out') options.outputDir = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage: node application-pack.mjs [options]

Options:
  --dry-run             Preview selected packs without writing files.
  --id <ids>            Build packs for comma-separated application IDs.
  --top <number>        Build packs for top N actionable applications. Default: ${DEFAULT_TOP}.
  --min-score <number>  Minimum tracker score for top mode. Default: ${DEFAULT_MIN_SCORE}.
  --out <path>          Output directory. Default: output/application-packs.
`);
}

function printResult(result) {
  const mode = result.dry_run ? 'dry-run' : 'write';
  console.log(`\nApplication pack ${mode}: ${result.selected.length}/${result.total_applications} selected.`);
  if (!result.dry_run) console.log(`Output: ${relativePath(result.output_dir)}`);

  for (const item of result.selected) {
    console.log(`- #${String(item.id).padStart(3, '0')} ${item.score}/100 ${item.company} | ${item.role} | CV ${item.cv_language.toUpperCase()}/${item.cv_variant} | ${relativePath(item.output)}`);
  }

  if (result.dry_run) console.log('Dry-run: no application packs were written.');
}

function relativePath(file) {
  return String(file || '').replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  try {
    printResult(buildApplicationPacks(options));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
