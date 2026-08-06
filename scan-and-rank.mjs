#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs } from './lib/config-loader.mjs';
import { evaluateJobFit } from './job-scoring-service.mjs';
import { runScan } from './scan-jobs.mjs';
import { normalizeJob, normalizeText, normalizeWhitespace, slugify, todayISO } from './lib/job-normalizer.mjs';
import { enrichJob } from './lib/job-enrichment.mjs';
import { appendJobIndex, addJobToLookup, createEmptyJobLookup, findJobInLookup, loadKnownJobLookup } from './lib/job-index.mjs';
import { evaluateJobQuality, loadQualityGateConfig } from './lib/job-quality-gate.mjs';
import { extractJobDescriptionMax } from './lib/job-description-extractor.mjs';
import { loadBrowserAgentConfig, validateBrowserAgentConfig } from './lib/browser-agent/safety.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export async function runScanAndRank(options = {}) {
  const root = options.projectRoot || projectRoot;
  const configs = loadJobFinderConfigs(root);
  const qualityConfig = loadQualityGateConfig(root);
  const minScore = Number(options.minScore ?? configs.scoring.recommendation_thresholds.maybe_min ?? 60);

  const scan = options.snapshot
    ? normalizeScanInput(options.snapshot)
    : options.candidates
      ? normalizeScanInput({ candidates: options.candidates })
      : options.fromSnapshot
    ? loadSnapshot(options.fromSnapshot, root)
    : await runScan({
        projectRoot: root,
        dryRun: true,
        includeSeen: options.includeSeen,
        refreshKnown: options.refreshKnown,
        limit: options.limit,
        profile: options.profile,
        source: options.source,
        jobBoards: options.jobBoards,
        writeSnapshot: false,
        updateHistory: false,
      });

  const normalized = scan.candidates.map((job) => enrichJob(normalizeJob(job)));
  const maxExtraction = await maybeMaxExtractWeakJobs(normalized, {
    root,
    qualityConfig,
    options,
  });
  const enriched = maxExtraction.jobs;
  const qualityChecked = enriched.map((job) => ({
    job,
    quality: evaluateJobQuality(job, qualityConfig),
  }));
  const qualityRejected = qualityChecked.filter(({ quality }) => !quality.passed);
  const qualityPassed = qualityChecked.filter(({ quality }) => quality.passed);

  const ranked = qualityPassed
    .map(({ job, quality }) => ({ job: { ...job, quality_gate: quality }, quality, evaluation: evaluateJobFit(job, configs) }))
    .sort((a, b) => b.evaluation.score - a.evaluation.score);

  const selected = ranked.filter(({ evaluation }) =>
    evaluation.recommendation !== 'discard' && Number(evaluation.score) >= minScore);
  const lowFitRejected = ranked.filter((item) => !selected.includes(item));

  const result = {
    scanned_at: scan.scanned_at || new Date().toISOString(),
    scanned: scan.candidates.length,
    scan_mode: scan.scan_mode || (options.includeSeen ? 'audit' : 'new-only'),
    known_index_size: scan.known_index_size,
    quality_checked: qualityChecked.length,
    quality_rejected: qualityRejected,
    quality_rejection_summary: summarizeQualityRejections(qualityRejected),
    ranked,
    selected,
    low_fit_rejected: lowFitRejected,
    low_fit_rejection_summary: summarizeLowFitRejections(lowFitRejected, minScore),
    skipped: scan.skipped || [],
    skip_summary: countBy(scan.skipped || [], 'reason'),
    errors: scan.errors || [],
    source_stats: scan.source_stats || [],
    max_extraction: maxExtraction.summary,
    written: [],
    write_skipped: [],
  };

  if (!options.dryRun) {
    const writeGuard = loadExistingWriteGuard(root, { mode: options.writeGuardMode || 'strict' });
    for (const item of selected.slice(0, Number(options.writeLimit ?? 10))) {
      const duplicateReason = duplicateWriteReason(writeGuard, item.job);
      if (duplicateReason) {
        result.write_skipped.push({
          company: item.job.company,
          title: item.job.title,
          link: item.job.link,
          reason: duplicateReason,
        });
        continue;
      }
      const written = writeEvaluatedJob(root, item.job, item.evaluation, configs);
      result.written.push(written);
      markWritten(writeGuard, item.job);
    }
    appendJobIndex(root, [
      ...ranked,
      ...qualityRejected.map((item) => ({ ...item, status: 'skipped_low_quality' })),
    ]);
    appendScanHistory(root, ranked, qualityRejected, minScore);
  }

  return result;
}

async function maybeMaxExtractWeakJobs(jobs, context) {
  const policy = maxExtractionPolicy(context.root, context.options);
  const summary = {
    enabled: policy.enabled,
    attempted: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    max_per_scan: policy.maxPerScan,
    items: [],
  };

  if (!policy.enabled) {
    summary.skipped = jobs.length;
    return { jobs, summary };
  }

  const browserConfig = loadBrowserAgentConfig(context.root);
  const validation = validateBrowserAgentConfig(browserConfig);
  if (validation.errors.length > 0) {
    summary.enabled = false;
    summary.error = `browser_agent_invalid: ${validation.errors.join('; ')}`;
    summary.skipped = jobs.length;
    return { jobs, summary };
  }

  const result = [];
  for (const job of jobs) {
    const quality = evaluateJobQuality(job, context.qualityConfig);
    const trigger = maxExtractionTrigger(job, quality, policy);

    if (!trigger.shouldRun || summary.attempted >= policy.maxPerScan) {
      if (trigger.shouldRun) summary.skipped += 1;
      result.push(job);
      continue;
    }

    summary.attempted += 1;
    try {
      const extraction = await extractJobDescriptionMax({
        projectRoot: context.root,
        url: job.link,
        browserConfig,
        write: policy.writeOutputs,
      });
      const merged = mergeMaxExtractedJob(job, extraction);
      const beforeChars = String(job.description || '').length;
      const afterChars = String(merged.description || '').length;
      const changed = jobFingerprintForCompare(job) !== jobFingerprintForCompare(merged) || afterChars > beforeChars;

      if (changed) summary.updated += 1;
      result.push(changed ? merged : job);
      summary.items.push({
        company: job.company,
        title: job.title,
        link: job.link,
        reason: trigger.reason,
        method: extraction.selected_text?.method || 'a confirmar',
        before_chars: beforeChars,
        after_chars: afterChars,
        updated: changed,
      });
    } catch (error) {
      summary.failed += 1;
      result.push(job);
      summary.items.push({
        company: job.company,
        title: job.title,
        link: job.link,
        reason: trigger.reason,
        error: error.message,
      });
    }
  }

  return { jobs: result, summary };
}

function maxExtractionPolicy(root, options = {}) {
  const browserConfig = loadBrowserAgentConfig(root);
  const fallback = browserConfig.scanner?.max_extraction_fallback || {};
  const enabledFromConfig = fallback.enabled !== false;
  const enabled = options.maxExtract === undefined ? enabledFromConfig : options.maxExtract === true;
  return {
    enabled,
    maxPerScan: Number(options.maxExtractLimit ?? fallback.max_per_scan ?? 5),
    minDescriptionChars: Number(options.maxExtractMinChars ?? fallback.min_description_chars ?? 800),
    triggerOnMissingCompany: fallback.trigger_on_missing_company !== false,
    triggerOnMissingLocationOrMode: fallback.trigger_on_missing_location_or_mode !== false,
    triggerOnQualityFailure: fallback.trigger_on_quality_failure !== false,
    writeOutputs: options.maxExtractWrite === true || fallback.write_outputs === true,
  };
}

function maxExtractionTrigger(job, quality, policy) {
  if (!job.link || !/^https?:\/\//i.test(job.link)) return { shouldRun: false, reason: 'unsupported_url' };
  if (normalizeText(job.source || '').includes('max_extractor')) return { shouldRun: false, reason: 'already_max_extracted' };

  const reasons = [];
  if (String(job.description || '').length < policy.minDescriptionChars) reasons.push('short_description');
  if (policy.triggerOnMissingCompany && isUnknown(job.company)) reasons.push('missing_company');
  if (
    policy.triggerOnMissingLocationOrMode
    && (isUnknown(job.location) || isUnknown(job.work_mode))
  ) reasons.push('missing_location_or_work_mode');
  if (policy.triggerOnQualityFailure && quality.passed === false && qualityLooksTextRelated(quality, job, policy)) reasons.push('quality_text_related_failure');

  return {
    shouldRun: reasons.length > 0,
    reason: reasons.join(', ') || 'not_weak',
  };
}

function qualityLooksTextRelated(quality, job, policy) {
  const reasons = [
    ...asArray(quality.rejection_reasons),
    ...asArray(quality.missing_fields),
    ...asArray(quality.warnings),
  ].map(normalizeText);

  if (String(job.description || '').length < policy.minDescriptionChars) return true;

  return reasons.some((reason) => [
    'no_description',
    'missing_company',
    'missing_title',
    'missing_location',
    'missing_work_mode',
    'missing_location_or_remote',
  ].includes(reason));
}

function mergeMaxExtractedJob(original, extraction) {
  const extracted = extraction.job || {};
  const merged = { ...original };
  for (const field of ['title', 'company']) {
    if (isUnknown(merged[field]) && isUsefulValue(extracted[field])) merged[field] = extracted[field];
  }

  const originalDescriptionLength = String(original.description || '').length;
  const extractedDescriptionLength = String(extracted.description || '').length;
  if (
    isUsefulValue(extracted.description)
    && (isUnknown(original.description) || extractedDescriptionLength > originalDescriptionLength)
  ) {
    merged.description = extracted.description;
  }

  for (const field of [
    'location',
    'work_mode',
    'compensation',
    'date_posted',
    'valid_through',
    'employment_type',
    'apply_url',
  ]) {
    if ((isUnknown(merged[field]) || field === 'apply_url') && isUsefulValue(extracted[field])) merged[field] = extracted[field];
  }

  const stack = [...asArray(original.stack_required), ...asArray(extracted.stack_required)]
    .map(String)
    .filter(Boolean);
  if (stack.length > 0) merged.stack_required = [...new Set(stack)];

  if (Number(extracted.asks_years_experience) > 0) merged.asks_years_experience = extracted.asks_years_experience;
  else if (String(extracted.description || '').length > String(original.description || '').length) merged.asks_years_experience = 0;

  merged.link = original.link || extracted.link;
  merged.source = `${original.source || 'scanner'} + max_extractor:${extraction.selected_text?.method || 'unknown'}`;
  merged.max_extraction = {
    selected_method: extraction.selected_text?.method || '',
    selected_chars: extraction.selected_text?.chars || 0,
    methods: extraction.methods || [],
    warnings: extraction.warnings || [],
  };

  const normalized = enrichJob(normalizeJob(merged));
  return {
    ...normalized,
    max_extraction: merged.max_extraction,
  };
}

function jobFingerprintForCompare(job) {
  return JSON.stringify({
    title: job.title,
    company: job.company,
    location: job.location,
    work_mode: job.work_mode,
    description: String(job.description || '').slice(0, 5000),
    stack_required: asArray(job.stack_required),
  });
}

function writeEvaluatedJob(root, job, evaluation, configs) {
  const nextId = getNextApplicationId(root);
  const date = todayISO();
  const reportName = `${String(nextId).padStart(3, '0')}-${slugify(job.company)}-${slugify(job.title)}-${date}.md`;
  const reportPath = join(root, 'reports', reportName);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, buildReport(nextId, job, evaluation, configs, date), 'utf-8');

  appendApplicationRow(root, {
    id: nextId,
    date,
    company: job.company,
    role: job.title,
    score: `${evaluation.score}/100`,
    status: 'Evaluated',
    pdf: '-',
    report: `[${String(nextId).padStart(3, '0')}](reports/${reportName})`,
    notes: buildDashboardNotes(evaluation),
  });
  appendPipelineProcessedEntry(root, nextId, job, evaluation);

  return {
    id: nextId,
    company: job.company,
    title: job.title,
    score: evaluation.score,
    recommendation: evaluation.recommendation,
    report: reportPath,
  };
}

function appendPipelineProcessedEntry(root, id, job, evaluation) {
  const file = join(root, 'data', 'pipeline.md');
  if (!existsSync(file)) return;

  const content = readFileSync(file, 'utf-8');
  if (content.includes(job.link)) return;

  const padded = String(id).padStart(3, '0');
  const line = `- [x] #${padded} | ${job.link} | ${tableCell(job.company)} | ${tableCell(job.title)} | ${evaluation.score}/100 | DASHBOARD - ${evaluation.recommendation} via scan-and-rank\n`;
  const notesMarker = '\n## Notes';

  if (content.includes(notesMarker)) {
    writeFileSync(file, content.replace(notesMarker, `\n${line}${notesMarker}`), 'utf-8');
    return;
  }

  appendFileSync(file, `\n${line}`, 'utf-8');
}

function buildReport(id, job, evaluation, configs, date) {
  const language = job.application_language || inferLanguage(job);
  const message = buildApplicationMessage(job, evaluation, configs, language);
  const cvAdjustments = buildCvAdjustments(job, evaluation, configs);
  const scoreLines = Object.entries(evaluation.score_breakdown)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
  const quality = job.quality_gate || {};

  return `# ${String(id).padStart(3, '0')} - ${job.company} - ${job.title}

**URL:** ${job.link}
**Canonical URL:** ${job.canonical_url || job.link}
**External ID:** ${job.external_id || 'a confirmar'}
**Date:** ${date}
**Company:** ${job.company}
**Role:** ${job.title}
**Score:** ${evaluation.score}/100
**Recommendation:** ${evaluation.recommendation}
**Source:** ${job.source || 'scanner'}
**Remote:** ${job.work_mode || 'a confirmar'} | ${job.location || 'a confirmar'}
**Comp:** ${job.compensation || 'a confirmar'}
**Seniority:** ${job.seniority || 'a confirmar'}
**Date Posted:** ${job.date_posted || 'a confirmar'}
**Valid Through:** ${job.valid_through || 'a confirmar'}
**Employment Type:** ${job.employment_type || 'a confirmar'}
**Quality Gate:** ${quality.passed === false ? 'failed' : 'passed'} (${quality.quality_score ?? 'a confirmar'}/100)

## Score Breakdown

${scoreLines}

## Data Quality

- Missing fields: ${asArray(quality.missing_fields).join(', ') || 'none'}
- Warnings: ${asArray(quality.warnings).join(', ') || 'none'}
- Description chars: ${quality.description_chars ?? String(job.description || '').length}
- Fingerprint: ${job.fingerprint || 'a confirmar'}

## Strengths

${bulletList(evaluation.strengths.map(humanizeFlag))}

## Red Flags

${bulletList(evaluation.red_flags.map(humanizeFlag))}

## Hard Blockers

${bulletList(evaluation.hard_blockers_triggered.map(humanizeFlag))}

## Stack Required

${bulletList(job.stack_required || [])}

## CV Adjustments

${bulletList(cvAdjustments)}

## Rascunho De Email

${message}

## Reasoning

${evaluation.reasoning}

## Next Action

${evaluation.next_action}
`;
}

function buildApplicationMessage(job, evaluation, configs, language) {
  const candidate = configs.profile.candidate || {};
  const messaging = configs.candidate_context?.messaging || {};
  const name = candidate.full_name || 'Candidate';
  const confirmedSkills = getConfirmedSkills(configs);
  const matchedSkills = asArray(job.stack_required).filter((tech) =>
    confirmedSkills.some((skill) => normalizeText(skill) === normalizeText(tech) || normalizeText(skill).includes(normalizeText(tech)) || normalizeText(tech).includes(normalizeText(skill))));
  const skillsText = sanitizeSkillsForDraft(matchedSkills.length > 0 ? matchedSkills : confirmedSkills.slice(0, 6), language).join(', ');
  const subject = language === 'pt'
    ? `Assunto: Candidatura - ${job.title}`
    : `Subject: Application - ${job.title}`;
  const isInternshipLike = looksInternshipLike(job);
  const cautionLine = evaluation.recommendation === 'maybe'
    ? (language === 'pt'
        ? 'Como alguns requisitos ainda ficam a confirmar, trataria esta candidatura como exploratoria e com total transparencia sobre o meu nivel atual.'
        : 'Because some requirements still need confirmation, I would treat this as an exploratory application and be fully transparent about my current level.')
    : '';
  const privateProjectLine = shouldMentionPrivateProject(job)
    ? (language === 'pt'
        ? (messaging.private_project_safe_line_pt || 'Tenho tambem um projeto privado ligado a automacao e integracoes, que posso apresentar por descricao tecnica, screenshots ou demo controlada sem expor codigo privado.')
        : (messaging.private_project_safe_line_en || 'I also have a private project focused on automation and integrations, which I can present through a technical description, screenshots or a controlled demo without exposing private code.'))
    : '';

  if (language === 'pt') {
    const targetFraming = isInternshipLike
      ? 'uma oportunidade junior/estagio onde possa crescer em desenvolvimento, automacao e sistemas de informacao com acompanhamento tecnico'
      : 'uma oportunidade junior/early-career onde possa contribuir em tarefas reais, aprender com a equipa e crescer com acompanhamento tecnico';

    const intro = messaging.safe_intro_pt || `O meu nome e ${name} e estou a concluir o TGPSI no INETE Arroios.`;

    return `${subject}

Boa tarde,

${intro} Tenho interesse na vaga de ${job.title} porque procuro ${targetFraming}.

Tenho bases praticas confirmadas em ${skillsText}. ${privateProjectLine}

${cautionLine}

Antes de enviar a candidatura final, gostaria de confirmar os pontos que ainda estao como a confirmar no report, especialmente elegibilidade, regime de trabalho e remuneracao/bolsa quando nao estiverem explicitos na oferta.

Cumprimentos,
${name}`;
  }

  const targetFraming = isInternshipLike
    ? 'a junior/internship opportunity where I can grow through practical engineering work and technical mentorship'
    : 'a junior or early-career opportunity where I can contribute to real engineering tasks, learn from the team and grow with technical mentorship';

  const intro = messaging.safe_intro_en || `My name is ${name} and I am completing a technical software development program at INETE Arroios in Lisbon, Portugal.`;

  return `${subject}

Hello,

${intro} I am interested in the ${job.title} role because I am looking for ${targetFraming}.

I have confirmed practical foundations in ${skillsText}. ${privateProjectLine}

${cautionLine}

Before sending the final application, I would like to confirm any details still marked as to be confirmed in the report, especially eligibility, work mode and compensation/stipend if they are not explicit in the job post.

Best regards,
${name}`;
}

function looksInternshipLike(job) {
  const text = normalizeText(`${job.title || ''} ${job.description || ''}`);
  return ['intern', 'internship', 'trainee', 'estagio', 'estagiario', 'iefp', 'graduate program'].some((needle) => text.includes(needle));
}

function buildCvAdjustments(job, evaluation, configs) {
  const skills = getConfirmedSkills(configs);
  const matched = asArray(job.stack_required).filter((tech) =>
    skills.some((skill) => normalizeText(skill) === normalizeText(tech) || normalizeText(skill).includes(normalizeText(tech)) || normalizeText(tech).includes(normalizeText(skill))));
  const adjustments = [
    'Manter posicionamento junior/estagio; nao apresentar perfil mid-level ou senior.',
    'Nao inventar experiencia, certificados, metricas, clientes, links ou projetos.',
  ];

  if (matched.length > 0) adjustments.push(`Dar prioridade a skills confirmadas que batem com a vaga: ${matched.join(', ')}.`);
  if (shouldMentionPrivateProject(job)) adjustments.push('Mencionar apenas um projeto privado de automacao como prova pratica/descricao tecnica/demo controlada; nao expor codigo privado nem nome nao confirmado.');
  if (evaluation.red_flags.length > 0) adjustments.push(`Confirmar antes de enviar: ${evaluation.red_flags.map(humanizeFlag).join(', ')}.`);
  return adjustments;
}

function appendApplicationRow(root, row) {
  const file = join(root, 'data', 'applications.md');
  const line = `| ${row.id} | ${row.date} | ${tableCell(row.company)} | ${tableCell(row.role)} | ${row.score} | ${row.status} | ${row.pdf} | ${row.report} | ${tableCell(row.notes)} |\n`;
  appendFileSync(file, line, 'utf-8');
}

function appendScanHistory(root, ranked, qualityRejected, minScore) {
  const file = join(root, 'data', 'scan-history.tsv');
  const header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n';
  if (!existsSync(file)) writeFileSync(file, header, 'utf-8');
  const existingUrls = new Set(extractUrls(readFileSync(file, 'utf-8')));

  const rankedRows = ranked.filter(({ job }) => !existingUrls.has(cleanUrl(job.link))).map(({ job, evaluation }) => {
    const status = evaluation.recommendation !== 'discard' && Number(evaluation.score) >= minScore
      ? 'evaluated'
      : 'skipped_low_fit';
    return [
      job.link,
      job.first_seen || todayISO(),
      job.source || 'scan-and-rank',
      job.title,
      job.company,
      status,
    ].map(tableCell).join('\t');
  });
  const qualityRows = qualityRejected.filter(({ job }) => !existingUrls.has(cleanUrl(job.link))).map(({ job }) => [
    job.link,
    job.first_seen || todayISO(),
    job.source || 'scan-and-rank',
    job.title,
    job.company,
    'skipped_low_quality',
  ].map(tableCell).join('\t'));

  const rows = [...rankedRows, ...qualityRows];
  if (rows.length > 0) appendFileSync(file, `${rows.join('\n')}\n`, 'utf-8');
}

function loadExistingWriteGuard(root, options = {}) {
  const strict = options.mode !== 'dashboard_only';
  const lookup = strict
    ? loadKnownJobLookup(root, { includeApplications: true })
    : createEmptyJobLookup();
  const urlFiles = strict
    ? [
        join(root, 'data', 'scan-history.tsv'),
        join(root, 'data', 'pipeline.md'),
      ]
    : [];
  const urls = new Set();
  const jobKeys = new Set();

  for (const file of urlFiles) {
    if (!existsSync(file)) continue;
    for (const url of extractUrls(readFileSync(file, 'utf-8'))) urls.add(url);
  }

  const reportsDir = join(root, 'reports');
  if (existsSync(reportsDir)) {
    for (const file of readdirSync(reportsDir).filter((name) => name.endsWith('.md'))) {
      const content = readFileSync(join(reportsDir, file), 'utf-8');
      for (const url of extractUrls(content)) urls.add(url);
      const company = content.match(/\*\*Company:\*\*\s*(.+)/)?.[1];
      const title = content.match(/\*\*Role:\*\*\s*(.+)/)?.[1];
      if (company || title) jobKeys.add(jobKey({ company, title }));
    }
  }

  const applicationsFile = join(root, 'data', 'applications.md');
  if (existsSync(applicationsFile)) {
    for (const line of readFileSync(applicationsFile, 'utf-8').split('\n')) {
      const parts = line.split('|').map((part) => part.trim());
      const id = Number(parts[1]);
      if (!Number.isFinite(id) || parts.length < 5) continue;
      jobKeys.add(jobKey({ company: parts[3], title: parts[4] }));
    }
  }

  return { urls, jobKeys, lookup, strict };
}

function duplicateWriteReason(guard, job) {
  if (guard.strict !== false) {
    const indexMatch = findJobInLookup(guard.lookup, job, { companyRole: true });
    if (indexMatch) return `duplicate_${indexMatch.type}`;
  }
  if (job.link && guard.urls.has(cleanUrl(job.link))) return 'duplicate_url';
  if (guard.jobKeys.has(jobKey(job))) return 'duplicate_company_role';
  return '';
}

function markWritten(guard, job) {
  if (job.link) guard.urls.add(cleanUrl(job.link));
  guard.jobKeys.add(jobKey(job));
  addJobToLookup(guard.lookup, job, { status: 'dashboard' });
}

function extractUrls(content) {
  return (content.match(/https?:\/\/[^\s|)\]]+/g) || []).map(cleanUrl);
}

function cleanUrl(value) {
  return String(value || '').replace(/[.,;]+$/, '');
}

function jobKey(job) {
  return `${keyPart(job.company)}::${keyPart(job.title || job.role)}`;
}

function keyPart(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function getNextApplicationId(root) {
  const file = join(root, 'data', 'applications.md');
  if (!existsSync(file)) return 1;
  const matches = [...readFileSync(file, 'utf-8').matchAll(/^\|\s*(\d+)\s*\|/gm)].map((match) => Number(match[1]));
  return matches.length > 0 ? Math.max(...matches) + 1 : 1;
}

function buildDashboardNotes(evaluation) {
  if (evaluation.recommendation === 'apply') {
    return 'APPLY - gerado por scan-and-rank; rever report e aprovar antes de enviar.';
  }
  return 'MAYBE - gerado por scan-and-rank; confirmar red flags antes de enviar.';
}

function loadSnapshot(file, root = projectRoot) {
  const absolute = resolve(root, file);
  const parsed = JSON.parse(readFileSync(absolute, 'utf-8'));
  return normalizeScanInput(parsed);
}

function normalizeScanInput(parsed = {}) {
  return {
    scanned_at: parsed.scanned_at || new Date().toISOString(),
    scan_mode: parsed.scan_mode || 'single-url',
    known_index_size: parsed.known_index_size,
    candidates: parsed.candidates || [],
    skipped: parsed.skipped || [],
    errors: parsed.errors || [],
    source_stats: parsed.source_stats || [],
  };
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    includeSeen: false,
    refreshKnown: false,
    limit: 30,
    profile: '',
    writeLimit: 10,
    source: '',
    fromSnapshot: '',
    minScore: undefined,
    writeGuardMode: '',
    maxExtract: undefined,
    maxExtractLimit: undefined,
    maxExtractMinChars: undefined,
    maxExtractWrite: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--new-only') options.includeSeen = false;
    else if (arg === '--audit') options.includeSeen = true;
    else if (arg === '--refresh-known') {
      options.includeSeen = true;
      options.refreshKnown = true;
    }
    else if (arg === '--include-seen') options.includeSeen = true;
    else if (arg === '--limit') options.limit = Number(argv[++index] || options.limit);
    else if (arg === '--profile') options.profile = argv[++index] || '';
    else if (arg === '--write-limit') options.writeLimit = Number(argv[++index] ?? options.writeLimit);
    else if (arg === '--source') options.source = argv[++index] || '';
    else if (arg === '--from-snapshot') options.fromSnapshot = argv[++index] || '';
    else if (arg === '--min-score') options.minScore = Number(argv[++index]);
    else if (arg === '--write-guard-mode') options.writeGuardMode = argv[++index] || '';
    else if (arg === '--no-job-boards') options.jobBoards = false;
    else if (arg === '--max-extract-weak') options.maxExtract = true;
    else if (arg === '--no-max-extract') options.maxExtract = false;
    else if (arg === '--max-extract-limit') options.maxExtractLimit = Number(argv[++index] ?? options.maxExtractLimit);
    else if (arg === '--max-extract-min-chars') options.maxExtractMinChars = Number(argv[++index] ?? options.maxExtractMinChars);
    else if (arg === '--max-extract-write') options.maxExtractWrite = true;
  }

  return options;
}

function printResult(result, dryRun) {
  console.log(`\nScan-and-rank complete: ${result.scanned} scanned, ${result.selected.length} selected. Mode: ${result.scan_mode || 'new-only'}.`);
  if (Number.isFinite(result.known_index_size)) console.log(`Known index size: ${result.known_index_size}`);
  console.log(`Quality gate: ${result.quality_checked || 0} checked, ${result.quality_rejected?.length || 0} rejected.`);
  console.log(`Fit filter: ${result.ranked.length || 0} ranked, ${result.low_fit_rejected?.length || 0} below threshold/discard.`);
  printMaxExtractionSummary(result.max_extraction);
  for (const { job, evaluation } of result.ranked.slice(0, 15)) {
    const marker = result.selected.some((item) => item.job.link === job.link) ? '*' : '-';
    console.log(`${marker} ${evaluation.score}/100 ${evaluation.recommendation.toUpperCase()} | ${job.company} | ${job.title} | ${job.link}`);
  }

  printSourceStats(result.source_stats || []);

  if (!dryRun && result.written.length > 0) {
    console.log('\nWritten to dashboard:');
    for (const item of result.written) {
      console.log(`- #${item.id} ${item.company} | ${item.title} | ${item.score}/100 | ${relativePath(item.report)}`);
    }
  } else if (dryRun) {
    console.log('\nDry-run: no dashboard entries or reports were written.');
  }

  if (!dryRun && result.write_skipped.length > 0) {
    console.log('\nSkipped dashboard writes:');
    for (const item of result.write_skipped) {
      console.log(`- ${item.company} | ${item.title} | ${item.reason}`);
    }
  }

  if (result.errors.length > 0) {
    console.log(`\nScan errors: ${result.errors.length}`);
    for (const error of result.errors.slice(0, 10)) console.log(`- ${error.company}: ${error.error}`);
  }

  if (result.quality_rejected?.length > 0) {
    console.log(`\nQuality rejected: ${result.quality_rejected.length}`);
    printCountSummary(result.quality_rejection_summary, 'Quality rejection summary');
    for (const { job, quality } of result.quality_rejected.slice(0, 8)) {
      console.log(`- ${job.company} | ${job.title} | ${quality.rejection_reasons.join(', ') || 'quality_gate_failed'}`);
    }
  }

  if (result.skipped?.length > 0) {
    console.log(`\nScanner skipped: ${result.skipped.length}`);
    printCountSummary(result.skip_summary, 'Scanner skip summary');
  }

  if (result.low_fit_rejected?.length > 0) {
    printCountSummary(result.low_fit_rejection_summary, 'Fit rejection summary');
  }
}

function printMaxExtractionSummary(summary = {}) {
  if (!summary || summary.enabled === undefined) return;

  if (!summary.enabled) {
    const reason = summary.error ? ` (${summary.error})` : '';
    console.log(`Max extraction fallback: disabled${reason}.`);
    return;
  }

  console.log(`Max extraction fallback: attempted ${summary.attempted || 0}/${summary.max_per_scan || 0}, updated ${summary.updated || 0}, failed ${summary.failed || 0}, skipped ${summary.skipped || 0}.`);
  for (const item of asArray(summary.items).slice(0, 5)) {
    const status = item.error ? `ERROR: ${item.error}` : `${item.before_chars || 0}->${item.after_chars || 0} chars via ${item.method || 'a confirmar'}`;
    console.log(`  - ${item.company || 'a confirmar'} | ${item.title || 'a confirmar'} | ${item.reason || 'weak_job'} | ${status}`);
  }
}

function printSourceStats(sourceStats) {
  if (sourceStats.length === 0) return;

  console.log('\nSource diagnostics:');
  for (const stat of sourceStats.slice(0, 25)) {
    const errorText = stat.error ? ` | ERROR: ${stat.error}` : '';
    console.log(`- ${stat.source} [${stat.type}]: found ${stat.discovered}, accepted ${stat.accepted}, skipped ${stat.skipped}${errorText}`);
  }
  if (sourceStats.length > 25) console.log(`- ... ${sourceStats.length - 25} more source(s)`);
}

function printCountSummary(summary, label) {
  const entries = Object.entries(summary || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);
  if (entries.length === 0) return;
  console.log(`${label}: ${entries.map(([key, value]) => `${key}: ${value}`).join(', ')}`);
}

function inferLanguage(job) {
  const company = normalizeText(job.company || '');
  const portugueseContextCompanies = [
    'santander',
    'noesis',
    'outsoft',
    'kodly',
    'dellent',
    'integer consulting',
    'critical manufacturing',
    'critical techworks',
    'it house',
    'neotalent',
    'myideas',
  ];
  const internationalDefaultEnglishCompanies = [
    'amgen',
    'sap',
    'celonis',
    'euronext',
    'cohere',
    'mistral ai',
    'deepl',
    'elevenlabs',
    'spotify',
    'palantir',
    'faculty',
  ];

  if (portugueseContextCompanies.some((item) => company.includes(normalizeText(item)))) return 'pt';
  if (internationalDefaultEnglishCompanies.some((item) => company.includes(normalizeText(item)))) return 'en';

  const text = normalizeText(`${job.company} ${job.location} ${job.link} ${job.description}`);
  return /portugal|lisboa|lisbon|porto|coimbra|aveiro|braga|\.pt/.test(text) ? 'pt' : 'en';
}

function shouldMentionPrivateProject(job) {
  const text = normalizeText(`${job.title} ${job.description} ${asArray(job.stack_required).join(' ')}`);
  return /ai|automation|automacao|full stack|full-stack|frontend|backend|developer|software|python|javascript|react|node/.test(text);
}

function getConfirmedSkills(configs) {
  return asArray(configs.profile.skills?.confirmed)
    .map((skill) => typeof skill === 'string' ? skill : skill?.name)
    .filter(Boolean);
}

function sanitizeSkillsForDraft(skills, language) {
  const seen = new Set();
  const clean = [];

  for (const skill of asArray(skills)) {
    const normalized = normalizeText(skill);
    let safe = skill;

    if (normalized === 'ai' || normalized === 'ia' || normalized === 'artificial intelligence' || normalized === 'inteligencia artificial') {
      safe = language === 'pt' ? 'ferramentas de IA e automacao' : 'AI tools and automation';
    }

    if (['cloud', 'docker', 'kubernetes', 'k8s', 'aws', 'azure', 'gcp', 'devops', 'ci/cd', 'cicd'].includes(normalized)) {
      continue;
    }

    const key = normalizeText(safe);
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(safe);
  }

  return clean.length > 0 ? clean : ['C#', 'JavaScript', 'SQL', 'Python'];
}

function bulletList(values) {
  const clean = values.map((value) => normalizeWhitespace(value)).filter(Boolean);
  if (clean.length === 0) return '- a confirmar';
  return clean.map((value) => `- ${value}`).join('\n');
}

function humanizeFlag(value) {
  return String(value || '')
    .replace(/^stack_match:/, 'stack match: ')
    .replace(/_/g, ' ');
}

function tableCell(value) {
  return normalizeWhitespace(value).replace(/\|/g, '/');
}

function relativePath(file) {
  return file.replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

function countBy(values, key) {
  const counts = {};
  for (const value of values || []) {
    const name = value?.[key] || 'unknown';
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
}

function summarizeQualityRejections(items) {
  const counts = {};
  for (const item of items || []) {
    const reasons = item.quality?.rejection_reasons?.length
      ? item.quality.rejection_reasons
      : ['quality_gate_failed'];
    for (const reason of reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function summarizeLowFitRejections(items, minScore) {
  const counts = {};
  for (const item of items || []) {
    const evaluation = item.evaluation || {};
    const reason = evaluation.recommendation === 'discard'
      ? 'discard_recommendation'
      : Number(evaluation.score) < Number(minScore)
        ? 'score_below_minimum'
        : 'not_selected';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isUnknown(value) {
  if (Array.isArray(value)) return value.length === 0 || value.every((item) => isUnknown(item));
  const text = normalizeText(value).replace(/\s+/g, ' ').trim();
  return !text || [
    '-',
    'a confirmar',
    'unknown',
    'n/a',
    'na',
    'not specified',
    'not provided',
    'undefined',
    'null',
  ].includes(text);
}

function isUsefulValue(value) {
  if (Array.isArray(value)) return value.some((item) => isUsefulValue(item));
  if (typeof value === 'number') return Number.isFinite(value);
  return !isUnknown(value);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  runScanAndRank(options)
    .then((result) => printResult(result, options.dryRun))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
