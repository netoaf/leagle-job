import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';

const DEFAULT_LIBRARY = {
  pt: {
    backend: 'output/cv-library/PT/CV-PT-Backend.pdf',
    fullstack: 'output/cv-library/PT/CV-PT-Fullstack.pdf',
    automation_qa: 'output/cv-library/PT/CV-PT-Automation-QA.pdf',
  },
  en: {
    backend: 'output/cv-library/EN/CV-EN-Backend.pdf',
    fullstack: 'output/cv-library/EN/CV-EN-Fullstack.pdf',
    automation_qa: 'output/cv-library/EN/CV-EN-Automation-QA.pdf',
  },
};

const VARIANT_LABELS = {
  backend: 'Backend',
  fullstack: 'Full-stack',
  automation_qa: 'Automation/QA',
};

export function selectCvForApplication(options = {}) {
  const application = options.application || {};
  const report = String(options.report || '');
  const profile = options.profile || {};
  const projectRoot = resolve(options.projectRoot || '.');
  const documents = profile.documents || {};
  const selectionConfig = documents.cv_selection || {};
  const library = mergeLibrary(documents.cv_library);

  const languageDecision = detectCvLanguage(application, report, selectionConfig);
  const variantDecision = detectCvVariant(application, selectionConfig);
  const sourceRelative = library[languageDecision.value]?.[variantDecision.value] || '';
  const sourcePath = sourceRelative ? resolve(projectRoot, sourceRelative) : '';
  const sourceExists = Boolean(sourcePath && existsSync(sourcePath));
  const outputDir = resolveOutputDirectory(
    projectRoot,
    options.outputDir || selectionConfig.output_directory || 'output/application-packs/cvs',
  );
  const outputFileName = buildOutputFileName(application, languageDecision.value, variantDecision.value);
  const outputPath = join(outputDir, outputFileName);
  const outputRelative = portableRelative(projectRoot, outputPath);
  const metadataPath = outputPath.replace(/\.pdf$/i, '.selection.json');

  const selection = {
    language: languageDecision.value,
    language_label: languageDecision.value.toUpperCase(),
    language_reason: languageDecision.reason,
    variant: variantDecision.value,
    variant_label: VARIANT_LABELS[variantDecision.value],
    variant_reason: variantDecision.reason,
    source_cv_pdf: sourceRelative,
    selected_cv_pdf: outputRelative,
    source_exists: sourceExists,
    status: sourceExists
      ? (options.dryRun ? 'ready in library; copy skipped in dry-run' : 'ready for human review')
      : 'missing source CV',
    human_review_required: true,
  };

  if (!options.dryRun && sourceExists) {
    mkdirSync(outputDir, { recursive: true });
    copyFileSync(sourcePath, outputPath);
    writeFileSync(metadataPath, `${JSON.stringify({
      application_id: application.id ?? null,
      company: repairMojibakeText(application.company),
      role: repairMojibakeText(application.role),
      selected_at: new Date().toISOString(),
      ...selection,
    }, null, 2)}\n`, 'utf-8');
  }

  return selection;
}

export function detectCvLanguage(application = {}, report = '', selectionConfig = {}) {
  const override = detectOverride(application, ['pt', 'en']);
  if (override) {
    return { value: override, reason: `manual notes override cv:${override}` };
  }

  const role = normalizeText(application.role);
  const notes = normalizeText(application.notes);
  const reportHead = normalizeText(String(report || '').slice(0, 5000));
  const combined = `${role} ${notes} ${reportHead}`;

  let portugueseScore = 0;
  let englishScore = 0;

  const portugueseRoleSignals = [
    'estagio', 'estagiario', 'programador', 'desenvolvimento', 'automacao',
    'tecnico', 'hibrido', 'licenciatura', 'grande lisboa', 'candidatura',
  ];
  const englishRoleSignals = [
    'software engineer', 'software developer', 'internship', 'intern ',
    'graduate', 'full stack', 'fullstack', 'backend', 'frontend',
  ];

  portugueseScore += countSignals(`${role} ${notes}`, portugueseRoleSignals) * 2;
  englishScore += countSignals(`${role} ${notes}`, englishRoleSignals);

  // The prepared message language is the strongest signal for the attachment
  // language. This prevents Portuguese tracker notes from forcing a PT CV into
  // an otherwise English application.
  if (/^(?:subject\s*:|hello\b|dear\b)/mi.test(report)) {
    englishScore += 8;
  }
  if (/^(?:assunto\s*:|bom dia\b|boa tarde\b|exmos?\.?\s+senhores)/mi.test(report)) {
    portugueseScore += 8;
  }

  if (/(?:net-empregos\.com|itjobs\.pt|emprego\.sapo\.pt|expressoemprego\.pt)/.test(reportHead)) {
    portugueseScore += 5;
  }
  if (/https?:\/\/[^\s/]+\.pt(?:\/|\s|$)/.test(reportHead)) {
    portugueseScore += 3;
  }
  if (/(?:ashbyhq\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com)/.test(reportHead)) {
    englishScore += 4;
  }
  if (/(?:canada|united states|united kingdom|ireland|germany|france|italy|spain|europe remote)/.test(combined)) {
    englishScore += 2;
  }

  if (portugueseScore > englishScore && portugueseScore >= 2) {
    return { value: 'pt', reason: 'Portuguese vacancy or Portugal-specific source detected' };
  }
  if (englishScore > portugueseScore && englishScore >= 3) {
    return { value: 'en', reason: 'international or English-language vacancy detected' };
  }

  const fallback = normalizeLanguage(selectionConfig.default_language) || 'pt';
  return { value: fallback, reason: `no decisive language signal; profile default ${fallback.toUpperCase()}` };
}

export function detectCvVariant(application = {}, selectionConfig = {}) {
  const override = detectOverride(application, [
    'backend', 'fullstack', 'full-stack', 'automation-qa', 'automation_qa', 'qa',
  ]);
  if (override) {
    const value = normalizeVariant(override);
    return { value, reason: `manual notes override cv:${override}` };
  }

  const role = normalizeText(`${application.role || ''} ${application.notes || ''}`);

  if (hasSignal(role, [
    ' qa ', 'quality assurance', 'quality tester', 'test engineer', 'tester funcional',
    'test automation', 'qa automatico', 'automacao', 'automation',
  ])) {
    return { value: 'automation_qa', reason: 'QA or automation role signal' };
  }

  if (hasSignal(role, [
    'full stack', 'fullstack', 'front end', 'frontend', 'web developer',
    'desenvolvimento web', 'wordpress', 'react developer', 'angular developer',
    'ui developer',
  ])) {
    return { value: 'fullstack', reason: 'full-stack, frontend or web role signal' };
  }

  if (hasSignal(role, [
    'backend', 'back end', ' api ', 'systems developer',
    'java developer', '.net developer', 'c# developer',
  ])) {
    return { value: 'backend', reason: 'backend, API or software systems role signal' };
  }

  const fallback = normalizeVariant(selectionConfig.default_variant) || 'backend';
  return { value: fallback, reason: `no decisive role signal; profile default ${VARIANT_LABELS[fallback]}` };
}

function mergeLibrary(configured = {}) {
  return {
    pt: { ...DEFAULT_LIBRARY.pt, ...(configured.pt || {}) },
    en: { ...DEFAULT_LIBRARY.en, ...(configured.en || {}) },
  };
}

function detectOverride(application, acceptedValues) {
  const text = String(`${application.role || ''} ${application.notes || ''}`).toLowerCase();
  for (const value of acceptedValues) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:\\[|\\b)cv\\s*:\\s*${escaped}(?:\\]|\\b)`, 'i').test(text)) return value;
  }
  return '';
}

function normalizeLanguage(value) {
  const text = String(value || '').toLowerCase();
  return ['pt', 'en'].includes(text) ? text : '';
}

function normalizeVariant(value) {
  const text = String(value || '').toLowerCase().replace(/_/g, '-');
  if (text === 'backend') return 'backend';
  if (['fullstack', 'full-stack'].includes(text)) return 'fullstack';
  if (['automation-qa', 'qa'].includes(text)) return 'automation_qa';
  return '';
}

function countSignals(text, signals) {
  return signals.reduce((total, signal) => total + (text.includes(signal) ? 1 : 0), 0);
}

function hasSignal(text, signals) {
  const padded = ` ${text} `;
  return signals.some((signal) => padded.includes(signal));
}

function buildOutputFileName(application, language, variant) {
  const id = String(application.id ?? '000').padStart(3, '0');
  const company = slugify(repairMojibakeText(application.company) || 'company');
  const role = slugify(repairMojibakeText(application.role) || 'role');
  const variantLabel = variant === 'automation_qa' ? 'automation-qa' : variant;
  return `${id}-${company}-${role}-${language}-${variantLabel}.pdf`;
}

function resolveOutputDirectory(projectRoot, value) {
  return isAbsolute(String(value || '')) ? resolve(String(value)) : resolve(projectRoot, String(value));
}

function portableRelative(root, file) {
  return relative(root, file).replace(/\\/g, '/');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.#:/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[.#:/]+/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'item';
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
