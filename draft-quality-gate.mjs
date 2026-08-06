#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs } from './lib/config-loader.mjs';
import { normalizeText, normalizeWhitespace } from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACK_DIR = join('output', 'application-packs');

const PORTUGUESE_CONTEXT_COMPANIES = [
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

const INTERNATIONAL_DEFAULT_EN_COMPANIES = [
  'amgen',
  'sap',
  'celonis',
  'euronext',
  'cohere',
  'canonical',
  'cloudflare',
  'perplexity',
  'mistral ai',
  'deepl',
  'elevenlabs',
  'spotify',
  'palantir',
  'faculty',
];

const BLOCKED_CLAIM_PATTERNS = [
  { code: 'production_claim', pattern: /\b(production[- ]ready|produto em producao|em producao|production product)\b/i },
  { code: 'commercial_claim', pattern: /\b(commercial deployment|implantacao comercial|deploy comercial|clientes?|clients?)\b/i },
  { code: 'metrics_claim', pattern: /\b(\d+\s*%|\d+x|60\s*fps|\d+\s*(users?|utilizadores|clientes?|clients?))\b/i },
  { code: 'certification_claim', pattern: /\b(certified|certificado|certificacao|certification)\b/i },
  { code: 'years_experience_claim', pattern: /\b\d+\+?\s*(anos|years?)\s+(de\s+)?(experiencia|experience)\b/i },
  { code: 'external_user_claim', pattern: /\b(ready for external users|pronto para utilizadores externos|distributed product)\b/i },
  { code: 'public_repo_claim', pattern: /\b(public repository|public repo|repositorio publico|repo publico)\b/i },
  { code: 'unconfirmed_private_project_name', pattern: privateProjectNamePattern() },
];

const SENIORITY_TERMS = [
  'mid-level',
  'mid level',
  'senior',
  'specialist',
  'especialista',
  'expert',
  'perito',
  'architect',
  'arquiteto',
  'arquitecto',
];

const DEVELOPING_TERMS = [
  'docker',
  'kubernetes',
  'k8s',
  'aws',
  'azure',
  'gcp',
  'cloud',
  'ci/cd',
  'cicd',
  'devops',
  'next.js',
  'nextjs',
  'cybersecurity',
  'ciberseguranca',
];

export function runDraftQualityGate(options = {}) {
  const root = options.projectRoot || projectRoot;
  const configs = loadJobFinderConfigs(root);
  const files = resolveInputFiles(root, options);
  const results = files.map((file) => validatePackFile(root, file, configs));
  const totals = summarizeResults(results);

  return {
    ok: totals.errors === 0,
    root,
    files_checked: files.length,
    totals,
    results,
  };
}

function validatePackFile(root, file, configs) {
  const absolutePath = resolve(root, file);
  const raw = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf-8') : '';
  const content = repairMojibakeText(raw);
  const metadata = extractMetadata(content);
  const sections = extractSections(content);
  const draft = sectionOrFallback(sections, ['Email Draft', 'Rascunho De Email', 'Rascunho de Email'], '');
  const issues = [];

  if (!content) {
    addIssue(issues, 'error', 'missing_pack', 'Application pack file is missing or empty.');
    return { file: relativePath(root, absolutePath), metadata, issues };
  }

  validatePackSafety(content, issues);
  validateDraftPresence(draft, issues);

  if (draft.trim()) {
    validateLanguage(draft, content, metadata, issues);
    validateSeniority(draft, issues);
    validateForbiddenClaims(draft, configs, issues);
    validateUnconfirmedLinksAndContact(draft, configs, issues);
    validateUnconfirmedOrBroadClaims(draft, configs, issues);
    validateConfirmationCoverage(draft, content, sections, issues);
  }

  return {
    file: relativePath(root, absolutePath),
    metadata,
    issues,
  };
}

function validatePackSafety(content, issues) {
  const text = normalizeText(content);
  if (!text.includes('needs human review')) {
    addIssue(issues, 'error', 'missing_human_review_status', 'Pack does not clearly say it needs human review.');
  }
  if (!text.includes('do not send automatically')) {
    addIssue(issues, 'error', 'missing_no_auto_send_rule', 'Pack does not clearly block automatic sending.');
  }
  if (!text.includes('do not upload cv automatically')) {
    addIssue(issues, 'error', 'missing_no_auto_upload_rule', 'Pack does not clearly block automatic CV upload.');
  }
}

function validateDraftPresence(draft, issues) {
  const clean = normalizeWhitespace(draft);
  if (!clean) {
    addIssue(issues, 'error', 'missing_email_draft', 'Email draft section is missing or empty.');
    return;
  }
  if (normalizeText(clean) === 'a confirmar') {
    addIssue(issues, 'error', 'placeholder_email_draft', 'Email draft is still a confirmar.');
  }
  if (clean.length < 180) {
    addIssue(issues, 'warning', 'draft_too_short', 'Email draft is very short; review before using.');
  }
  if (clean.length > 1800) {
    addIssue(issues, 'warning', 'draft_too_long', 'Email draft is long; trim before sending.');
  }
}

function validateLanguage(draft, content, metadata, issues) {
  const expected = inferExpectedLanguage(content, metadata);
  const actual = detectDraftLanguage(draft);

  if (!expected) {
    if (actual === 'mixed') {
      addIssue(issues, 'warning', 'mixed_language', 'Draft mixes Portuguese and English; review language manually.');
    }
    return;
  }

  if (actual === 'unknown') {
    addIssue(issues, 'warning', 'language_unknown', `Could not confidently detect draft language; expected ${expected}.`);
    return;
  }

  if (actual !== expected) {
    addIssue(
      issues,
      'error',
      'wrong_language',
      `Draft language appears to be ${actual}, but this application should be ${expected}.`,
    );
  }
}

function validateSeniority(draft, issues) {
  for (const line of draftLines(draft)) {
    const normalized = normalizeText(line);
    for (const term of SENIORITY_TERMS) {
      const index = normalized.indexOf(normalizeText(term));
      if (index < 0) continue;
      if (hasNegationNear(normalized, index)) continue;
      addIssue(issues, 'error', 'seniority_exaggeration', `Risky seniority/authority wording: "${line}".`);
    }
  }
}

function validateForbiddenClaims(draft, configs, issues) {
  const forbidden = collectForbiddenClaimTerms(configs);

  for (const line of draftLines(draft)) {
    const normalized = normalizeText(line);

    for (const item of forbidden) {
      const term = normalizeText(item);
      if (!term || !normalized.includes(term)) continue;
      if (hasNegationNear(normalized, normalized.indexOf(term))) continue;
      addIssue(issues, 'error', 'forbidden_claim', `Forbidden or unsupported claim appears in draft: "${line}".`);
    }

    for (const { code, pattern } of BLOCKED_CLAIM_PATTERNS) {
      const match = line.match(pattern);
      if (!match) continue;
      const index = normalizeText(line).indexOf(normalizeText(match[0]));
      if (index >= 0 && hasNegationNear(normalizeText(line), index)) continue;
      addIssue(issues, 'error', code, `Unsupported claim pattern appears in draft: "${line}".`);
    }
  }
}

function validateUnconfirmedLinksAndContact(draft, configs, issues) {
  const allowedLinks = collectConfirmedLinks(configs);
  const urls = extractUrls(draft);

  for (const url of urls) {
    const normalizedUrl = normalizeUrlish(url);
    const allowed = allowedLinks.some((link) => normalizedUrl.includes(link) || link.includes(normalizedUrl));
    if (!allowed) {
      addIssue(issues, 'error', 'unconfirmed_link', `Draft includes unconfirmed link: ${url}`);
    }
  }

  const contactStatus = configs.candidate_context?.contact_status || {};
  const phoneStatus = normalizeText(contactStatus.phone_status || configs.profile?.candidate?.phone_status || '');
  const phoneNumbers = extractPhoneNumbers(draft);
  if (phoneNumbers.length > 0 && !phoneStatus.includes('confirmed')) {
    addIssue(issues, 'error', 'unconfirmed_phone', 'Draft includes phone number but phone is not confirmed for applications.');
  }

  const portfolio = contactStatus.portfolio_url || configs.profile?.candidate?.portfolio_url || '';
  const portfolioStatus = normalizeText(contactStatus.portfolio_status || configs.profile?.candidate?.portfolio_status || '');
  if (isConcreteLink(portfolio) && normalizeText(draft).includes(normalizeText(portfolio)) && !portfolioStatus.includes('confirmed')) {
    addIssue(issues, 'error', 'unconfirmed_portfolio', 'Draft includes portfolio/demo link but portfolio status is not confirmed.');
  }
}

function validateUnconfirmedOrBroadClaims(draft, configs, issues) {
  const confirmedSkills = collectConfirmedSkills(configs).map(normalizeText);

  for (const line of draftLines(draft)) {
    const normalized = normalizeText(line);
    if (!looksLikeCandidateClaim(normalized)) continue;

    for (const term of DEVELOPING_TERMS) {
      if (!normalized.includes(normalizeText(term))) continue;
      if (hasLearningContext(normalized) || hasNegationNear(normalized, normalized.indexOf(normalizeText(term)))) continue;
      addIssue(issues, 'error', 'unconfirmed_learning_skill_claim', `Learning-area technology is claimed as confirmed skill: "${line}".`);
    }

    const mentionsBroadAi = /\b(ai|ia|inteligencia artificial|artificial intelligence)\b/i.test(normalized);
    const hasSafeAiContext = /ai tools|ferramentas de ia|coding tools|prompt|automation|automacao|applied ai|ia aplicada|learning|aprender|interesse/.test(normalized);
    const confirmedAiTooling = confirmedSkills.some((skill) => ['ai tools', 'prompt engineering'].includes(skill));
    if (mentionsBroadAi && !hasSafeAiContext && confirmedAiTooling) {
      addIssue(issues, 'error', 'broad_ai_claim', `Draft makes a broad AI claim; narrow it to AI tools, prompt engineering or automation: "${line}".`);
    }
  }
}

function validateConfirmationCoverage(draft, content, sections, issues) {
  const confirmationText = normalizeText([
    sections['Confirm Before Sending'] || '',
    sections['Red Flags'] || '',
    sections['Hard Blockers'] || '',
    content,
  ].join('\n'));
  const draftText = normalizeText(draft);
  const needsConfirmation = /a confirmar|no salary|stipend|salary|compensation|bolsa|remuneracao|regime|work mode|remote|hybrid|hibrido|eligib|elegib|degree|licenciatura|language|ingles|english/.test(confirmationText);

  if (!needsConfirmation) return;

  const hasConfirmationLine = /confirm|clarif|esclarec|a confirmar|to be confirmed|before sending|antes de enviar|gostaria de confirmar|would like to confirm/.test(draftText);
  if (!hasConfirmationLine) {
    addIssue(issues, 'error', 'missing_confirmation_request', 'Pack has unresolved details, but draft does not ask to confirm them before sending.');
  }
}

function inferExpectedLanguage(content, metadata) {
  const company = normalizeText(metadata.company || '');
  const role = normalizeText(metadata.role || '');
  const text = normalizeText(`${metadata.company || ''} ${metadata.role || ''} ${content}`);

  if (PORTUGUESE_CONTEXT_COMPANIES.some((item) => company.includes(normalizeText(item)))) return 'pt';
  if (role.includes('portugal/hibrido') || role.includes('portugal hibrido')) return 'pt';
  if (role.includes('iefp')) return 'pt';
  if (INTERNATIONAL_DEFAULT_EN_COMPANIES.some((item) => company.includes(normalizeText(item)))) return 'en';
  if (/borsa italiana|german speaking|munich|milan|paris|new york|london|remote europe/.test(text)) return 'en';
  if (/lisboa|porto|coimbra|aveiro|braga|portugal|estagio|estagiario/.test(text)) return 'pt';
  return 'en';
}

function detectDraftLanguage(draft) {
  const text = normalizeText(draft);
  const ptScore = countMatches(text, [
    'assunto:',
    'boa tarde',
    'cumprimentos',
    'candidatura',
    'o meu nome',
    'estou a concluir',
    'tenho interesse',
    'gostaria de confirmar',
    'remuneracao',
    'estagio',
  ]);
  const enScore = countMatches(text, [
    'subject:',
    'hello',
    'dear',
    'best regards',
    'kind regards',
    'application',
    'my name is',
    'i am completing',
    'i am interested',
    'i would like to confirm',
    'before sending',
  ]);

  if (ptScore >= 2 && enScore >= 2) return ptScore === enScore ? 'mixed' : (ptScore > enScore ? 'pt' : 'en');
  if (ptScore >= 2) return 'pt';
  if (enScore >= 2) return 'en';
  return 'unknown';
}

function collectForbiddenClaimTerms(configs) {
  const terms = new Set([
    ...SENIORITY_TERMS,
    'production ML engineer',
    'consultant with client delivery experience',
  ]);

  for (const item of asArray(configs.profile?.positioning?.do_not_present_as)) terms.add(item);
  for (const item of asArray(configs.candidate_context?.positioning?.avoid_positioning)) terms.add(item);
  for (const project of asArray(configs.profile?.projects?.confirmed)) {
    for (const item of asArray(project.forbidden_claims)) terms.add(item);
  }
  for (const project of asArray(configs.candidate_context?.projects)) {
    for (const item of asArray(project.forbidden_claims)) terms.add(item);
    for (const item of asArray(project.never_expose)) terms.add(item);
  }

  return [...terms].filter(Boolean);
}

function collectConfirmedLinks(configs) {
  const contact = configs.candidate_context?.contact_status || {};
  const profileCandidate = configs.profile?.candidate || {};
  const candidates = [
    ['linkedin', contact.linkedin || profileCandidate.linkedin, contact.linkedin_status || profileCandidate.linkedin_status],
    ['github', contact.github || profileCandidate.github, contact.github_status || profileCandidate.github_status],
    ['portfolio', contact.portfolio_url || profileCandidate.portfolio_url, contact.portfolio_status || profileCandidate.portfolio_status],
  ];

  return candidates
    .filter(([, value, status]) => value && normalizeText(status || '').includes('confirmed'))
    .map(([, value]) => normalizeUrlish(value));
}

function collectConfirmedSkills(configs) {
  const values = [];
  for (const skill of asArray(configs.profile?.skills?.confirmed)) {
    values.push(typeof skill === 'string' ? skill : skill?.name);
  }

  const grouped = configs.candidate_context?.confirmed_skills || {};
  for (const group of Object.values(grouped)) {
    for (const value of asArray(group)) values.push(value);
  }
  return [...new Set(values.filter(Boolean))];
}

function extractMetadata(content) {
  return {
    company: metadataValue(content, 'Company'),
    role: metadataValue(content, 'Role'),
    score: metadataValue(content, 'Score'),
    status: metadataValue(content, 'Status'),
  };
}

function metadataValue(content, key) {
  const pattern = new RegExp(`^\\*\\*${escapeRegExp(key)}:\\*\\*\\s*(.+)$`, 'mi');
  return normalizeWhitespace(content.match(pattern)?.[1] || '');
}

function extractSections(content) {
  const sections = {};
  const matches = [...content.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const title = normalizeWhitespace(match[1]);
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : content.length;
    sections[title] = content.slice(start, end).trim();
  }
  return sections;
}

function sectionOrFallback(sections, names, fallback) {
  for (const name of names) {
    if (sections[name]) return sections[name];
  }
  return fallback;
}

function resolveInputFiles(root, options) {
  if (options.files.length > 0) return options.files.map((file) => resolve(root, file));

  const packDir = resolve(root, options.packDir || DEFAULT_PACK_DIR);
  if (!existsSync(packDir)) return [];
  return readdirSync(packDir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(packDir, name));
}

function draftLines(draft) {
  return String(draft || '')
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function looksLikeCandidateClaim(normalizedLine) {
  return /\b(tenho|tenho vindo|desenvolvi|construi|sou|i have|i built|i developed|my experience|confirmed practical foundations|bases praticas|bases confirmadas|conhecimentos|experiencia)\b/.test(normalizedLine);
}

function hasLearningContext(normalizedLine) {
  return /\b(aprender|learning|interesse|interested|curiosity|curiosidade|a confirmar|preferencial|preferred|gap|actively learning|em aprendizagem|quero aprender)\b/.test(normalizedLine);
}

function hasNegationNear(normalizedLine, index) {
  const before = normalizedLine.slice(Math.max(0, index - 80), index);
  return /\b(nao|not|never|nunca|sem|without|do not|dont|don't|not positioning|nao me posiciono|evitar|avoid)\b/.test(before);
}

function extractUrls(text) {
  return [...String(text || '').matchAll(/\bhttps?:\/\/[^\s)>\]]+/gi)].map((match) => match[0].replace(/[.,;:]+$/, ''));
}

function extractPhoneNumbers(text) {
  return [...String(text || '').matchAll(/(?:\+351[\s.-]?)?(?:9\d{2}[\s.-]?\d{3}[\s.-]?\d{3})\b/g)]
    .map((match) => match[0]);
}

function isConcreteLink(value) {
  const text = String(value || '').trim();
  const normalized = normalizeText(text);
  if (!text || normalized === 'a confirmar') return false;
  return /^https?:\/\//i.test(text) || /^[\w.-]+\.[a-z]{2,}/i.test(text);
}

function normalizeUrlish(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function addIssue(issues, severity, code, message) {
  issues.push({ severity, code, message });
}

function summarizeResults(results) {
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    for (const issue of result.issues) {
      if (issue.severity === 'error') errors += 1;
      if (issue.severity === 'warning') warnings += 1;
    }
  }
  return { errors, warnings };
}

function printResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('\nDraft quality gate');
  console.log('==================');
  console.log(`Files checked: ${result.files_checked}`);
  console.log(`Errors: ${result.totals.errors}`);
  console.log(`Warnings: ${result.totals.warnings}`);

  for (const item of result.results) {
    if (item.issues.length === 0) continue;
    console.log(`\n${item.file}`);
    if (item.metadata.company || item.metadata.role) {
      console.log(`  ${item.metadata.company || 'a confirmar'} | ${item.metadata.role || 'a confirmar'}`);
    }
    for (const issue of item.issues) {
      console.log(`  [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`);
    }
  }

  console.log('\nResult:', result.ok ? 'PASS' : 'FAIL');
}

function parseArgs(argv) {
  const options = {
    files: [],
    packDir: DEFAULT_PACK_DIR,
    json: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--file') options.files.push(argv[++index] || '');
    else if (arg === '--pack-dir') options.packDir = argv[++index] || DEFAULT_PACK_DIR;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  options.files = options.files.filter(Boolean);
  return options;
}

function printHelp() {
  console.log(`
Usage: node draft-quality-gate.mjs [options]

Options:
  --file <path>       Validate one application pack. Can be repeated.
  --pack-dir <path>   Directory with application packs. Default: ${DEFAULT_PACK_DIR}.
  --json              Print JSON result.
`);
}

function countMatches(text, needles) {
  return needles.reduce((count, needle) => count + (text.includes(normalizeText(needle)) ? 1 : 0), 0);
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

function relativePath(root, file) {
  return String(file || '').replace(`${root}\\`, '').replace(`${root}/`, '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function privateProjectNamePattern() {
  const confirmedName = ['w', 'ar', 'vis'].join('');
  const misspelledName = ['w', 'air', 'vis'].join('');
  return new RegExp(`\\b(?:${escapeRegExp(confirmedName)}|${escapeRegExp(misspelledName)})\\b`, 'i');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = runDraftQualityGate(options);
    printResult(result, options);
    if (!result.ok) process.exit(1);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
