#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { canonicalUrl } from './lib/job-identity.mjs';
import { extractStack, inferCompensation, inferWorkMode, normalizeJob, normalizeText, normalizeWhitespace } from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const UNKNOWN = 'a confirmar';

const EXTRA_TECH_TERMS = [
  'Pandas',
  'NumPy',
  'Pydantic',
  'LangChain',
  'Django',
  'Flask',
  'FastAPI',
  'Oracle SOA Suite',
  'SOAP',
  'REST',
  'PLSQL',
  'PL/SQL',
  'Mirth Connect',
  'HL7 FHIR',
  'XML',
  'JSON',
  'CI/CD',
  'Docker',
  'Azure',
  'Excel',
  'Bases de dados',
  'Power BI',
  'ETL',
  'Data Modeling',
  'CRM Dynamics',
  'Microservicos',
];

export function enrichExistingReports(options = {}) {
  const root = options.projectRoot || projectRoot;
  const snapshotMap = loadSnapshotCandidates(root);
  const rows = loadApplicationRows(root, options.ids || []);
  const results = [];

  for (const row of rows) {
    if (!row.report || !existsSync(join(root, row.report))) continue;
    const reportPath = join(root, row.report);
    const reportText = readFileSync(reportPath, 'utf-8');
    const url = canonicalUrl(reportText.match(/\*\*URL:\*\*\s*(\S+)/)?.[1] || row.url || '');
    const candidate = snapshotMap.get(url);
    if (!candidate) {
      results.push({ id: row.id, company: row.company, role: row.role, status: 'no_snapshot_match' });
      continue;
    }

    const job = normalizeJob(candidate);
    const enrichment = buildEnrichment(job);
    const updated = applyEnrichment(reportText, enrichment);
    const changed = updated !== reportText;

    if (changed && options.write) writeFileSync(reportPath, updated, 'utf-8');

    results.push({
      id: row.id,
      company: row.company,
      role: row.role,
      status: changed ? (options.write ? 'updated' : 'would_update') : 'unchanged',
      report: row.report,
      found: enrichment.summary,
    });
  }

  return results;
}

function loadSnapshotCandidates(root) {
  const outputDir = join(root, 'output');
  const files = existsSync(outputDir)
    ? walk(outputDir).filter((file) => file.endsWith('.json'))
    : [];
  const map = new Map();

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      for (const candidate of snapshotCandidates(data)) addCandidate(map, candidate);
    } catch {
      // Ignore non-snapshot JSON artifacts.
    }
  }

  return map;
}

function snapshotCandidates(data) {
  const candidates = [];
  if (Array.isArray(data.candidates)) candidates.push(...data.candidates);
  if (data.job?.link || data.job?.url) candidates.push(data.job);
  if (data.extraction?.job?.link || data.extraction?.job?.url) candidates.push(data.extraction.job);
  return candidates;
}

function addCandidate(map, candidate) {
  const url = canonicalUrl(candidate.link || candidate.url || '');
  if (url && !map.has(url)) map.set(url, candidate);
}

function loadApplicationRows(root, ids) {
  const file = join(root, 'data', 'applications.md');
  const wanted = new Set(ids.map(Number).filter(Boolean));
  return readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const parts = line.split('|').map((part) => part.trim());
      return {
        id: Number(parts[1]),
        company: parts[3],
        role: parts[4],
        score: parts[5],
        report: parts[8]?.match(/\(([^)]+)\)/)?.[1] || '',
      };
    })
    .filter((row) => wanted.size === 0 || wanted.has(row.id));
}

function buildEnrichment(job) {
  const text = normalizeWhitespace(job.description || '');
  const haystack = `${job.title || ''} ${job.location || ''} ${job.work_mode || ''} ${text}`;
  const datePosted = job.date_posted || extractPostedDate(text);
  const workMode = normalizeUnknown(job.work_mode) || normalizeUnknown(inferWorkMode(haystack));
  const location = refineLocation(job.location, text);
  const compensation = refineCompensation(job.compensation, text);
  const employmentType = job.employment_type || inferEmploymentType(haystack);
  const stack = unique([...extractStack(haystack), ...extractExtraTech(haystack)]);
  const requirements = extractRequirementSignals(haystack);
  const contact = extractContactSignal(text);

  const bullets = [];
  if (datePosted) bullets.push(`Data publicada: ${datePosted} (fonte: descricao da vaga/snapshot).`);
  if (location) bullets.push(`Local confirmado: ${location}.`);
  if (workMode) bullets.push(`Regime confirmado/inferido da vaga: ${workMode}.`);
  if (compensation) bullets.push(`Compensacao/bolsa: ${compensation}.`);
  if (employmentType) bullets.push(`Tipo de oportunidade: ${employmentType}.`);
  if (stack.length > 0) bullets.push(`Stack/temas mencionados: ${stack.slice(0, 14).join(', ')}.`);
  for (const item of requirements) bullets.push(item);
  if (contact) bullets.push(contact);
  if (bullets.length === 0) bullets.push('Nao foi encontrada informacao adicional confirmavel nos snapshots locais.');

  return {
    datePosted,
    workMode,
    location,
    compensation,
    employmentType,
    stack,
    bullets,
    summary: {
      date_posted: datePosted || UNKNOWN,
      location: location || UNKNOWN,
      work_mode: workMode || UNKNOWN,
      compensation: compensation || UNKNOWN,
      employment_type: employmentType || UNKNOWN,
      stack_count: stack.length,
    },
  };
}

function applyEnrichment(reportText, enrichment) {
  let text = reportText;

  if (enrichment.workMode || enrichment.location) {
    text = text.replace(/\*\*Remote:\*\*.*$/m, (line) => {
      const [, current] = line.match(/\*\*Remote:\*\*\s*(.*)$/) || [];
      const [currentMode = UNKNOWN, currentLocation = UNKNOWN] = String(current || '').split('|').map((part) => part.trim());
      const mode = enrichment.workMode || currentMode || UNKNOWN;
      const location = enrichment.location || currentLocation || UNKNOWN;
      return `**Remote:** ${mode} | ${location}`;
    });
  }

  if (enrichment.compensation) {
    text = replaceFieldLine(text, 'Comp', enrichment.compensation);
  }
  if (enrichment.datePosted) {
    text = replaceUnknownField(text, 'Date Posted', enrichment.datePosted);
  }
  if (enrichment.employmentType) {
    text = replaceUnknownField(text, 'Employment Type', enrichment.employmentType);
  }

  if (enrichment.stack.length > 0) {
    text = text.replace(/## Stack Required\s*\n\n[\s\S]*?(?=\n## )/, `## Stack Required\n\n${bulletList(enrichment.stack)}\n\n`);
  }

  const section = `## Informacao Confirmada Extra\n\n${bulletList(enrichment.bullets)}\n\n`;
  if (/## Informacao Confirmada Extra/.test(text)) {
    text = text.replace(/## Informacao Confirmada Extra\s*\n\n[\s\S]*?(?=\n## )/, section);
  } else if (/## Data Quality\s*\n\n[\s\S]*?(?=\n## )/.test(text)) {
    text = text.replace(/(## Data Quality\s*\n\n[\s\S]*?)(?=\n## )/, `$1${section}`);
  } else {
    text = text.replace(/\n## Score Breakdown/, `\n${section}## Score Breakdown`);
  }

  return text;
}

function replaceUnknownField(text, label, value) {
  const pattern = new RegExp(`\\*\\*${escapeRegExp(label)}:\\*\\*\\s*${UNKNOWN}`, 'm');
  return text.replace(pattern, `**${label}:** ${value}`);
}

function replaceFieldLine(text, label, value) {
  const pattern = new RegExp(`^\\*\\*${escapeRegExp(label)}:\\*\\*.*$`, 'm');
  return text.replace(pattern, `**${label}:** ${value}`);
}

function extractPostedDate(text) {
  const match = normalizeWhitespace(text).match(/\b(\d{1,2}-\d{1,2}-\d{4})\b/);
  return match?.[1] || '';
}

function refineLocation(location, text) {
  const current = normalizeUnknown(location);
  const local = matchFirst(text, [
    /\bLocal:\s*([^.;\n]+)/i,
    /\bLocal de Trabalho:\s*([^.;\n]+)/i,
    /\bWorkplace:\s*([^.;\n]+)/i,
    /\bRegime e Local de Trabalho:\s*([^.;\n]+)/i,
  ]);
  return normalizeWhitespace(cleanLocationSignal(local) || current);
}

function cleanLocationSignal(value) {
  let text = normalizeWhitespace(value || '');
  if (!text) return '';
  text = text
    .replace(/\bClaranet,.*$/i, '')
    .replace(/\bPartilhar\b.*$/i, '')
    .replace(/\bCandidata-te\b.*$/i, '')
    .replace(/\bCandidate-se\b.*$/i, '')
    .replace(/\bA Fapajal\b.*$/i, '')
    .replace(/\bA Heading\b.*$/i, '')
    .replace(/\bA Float\b.*$/i, '')
    .replace(/\bA Prosegur\b.*$/i, '')
    .replace(/\bPrincipal\b.*$/i, '')
    .replace(/\bPerfil\b.*$/i, '')
    .replace(/\bO que\b.*$/i, '')
    .replace(/\bRequisitos\b.*$/i, '')
    .trim();

  const hybridMatch = text.match(/hibrido\s*\(([^)]+)\)/i);
  if (hybridMatch?.[1]) return normalizeWhitespace(hybridMatch[1]);

  text = text.replace(/\s*-\s*(hybrid|hibrido|remote|remoto|onsite|presencial)\b.*$/i, '').trim();
  return text.length > 90 ? text.slice(0, 90).trim() : text;
}

function refineCompensation(compensation, text) {
  const current = normalizeUnknown(compensation);
  if (current) return humanizeCompensation(current);
  const normalized = normalizeText(text);
  if (normalized.includes('valor base') && normalized.includes('subsidio de alimentacao')) {
    return 'a confirmar: valor base + subsidio de alimentacao mencionados';
  }
  if (normalized.includes('package salarial') || normalized.includes('salary package')) {
    return 'a confirmar: pacote salarial mencionado';
  }
  if (normalized.includes('estagio iefp')) {
    return 'a confirmar: enquadramento IEFP mencionado';
  }
  const inferred = normalizeUnknown(inferCompensation(text));
  return humanizeCompensation(inferred);
}

function humanizeCompensation(value) {
  if (value === 'a confirmar: paid signal') return 'a confirmar: sinal de remuneracao/bolsa mencionado';
  return value;
}

function inferEmploymentType(text) {
  const normalized = normalizeText(text);
  if (normalized.includes('estagio iefp') || normalized.includes('estagio profissional iefp')) return 'Estagio IEFP';
  if (normalized.includes('estagio curricular')) return 'Estagio curricular';
  if (normalized.includes('internship')) return 'Internship';
  if (normalized.includes('contrato de trabalho')) return 'Contrato de trabalho';
  if (normalized.includes('full-time') || normalized.includes('full time')) return 'Full-time';
  return '';
}

function extractExtraTech(text) {
  const normalized = normalizeText(text);
  return EXTRA_TECH_TERMS.filter((term) => normalized.includes(normalizeText(term)));
}

function extractRequirementSignals(text) {
  const normalized = normalizeText(text);
  const items = [];
  if (normalized.includes('licenciatura') || normalized.includes('mestrado')) {
    items.push('Requisito a confirmar: a vaga menciona licenciatura/mestrado ou frequencia de ensino superior.');
  }
  if (normalized.includes('elegibilidade para estagio profissional iefp')) {
    items.push('Requisito a confirmar: elegibilidade para estagio profissional IEFP.');
  }
  if (/\b[1-9]\+?\s*(anos|years)\b/.test(normalized)) {
    const match = normalized.match(/\b[1-9]\+?\s*(anos|years)\b/);
    items.push(`Experiencia pedida a confirmar: a descricao menciona ${match?.[0] || 'anos/years'}.`);
  }
  return unique(items);
}

function extractContactSignal(text) {
  if (/mostrar email/i.test(text)) return 'Contacto: a oferta indica email no portal, mas o endereco nao foi exposto no snapshot.';
  return '';
}

function matchFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function normalizeUnknown(value) {
  const text = normalizeWhitespace(value || '');
  return !text || normalizeText(text) === normalizeText(UNKNOWN) ? '' : text;
}

function bulletList(items) {
  const list = unique(items.map(normalizeWhitespace).filter(Boolean));
  return list.length > 0 ? list.map((item) => `- ${item}`).join('\n') : `- ${UNKNOWN}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const options = { write: false, ids: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--ids') {
      options.ids.push(...String(argv[++index] || '').split(',').map((value) => Number(value.trim())).filter(Boolean));
    } else if (/^\d+$/.test(arg)) {
      options.ids.push(Number(arg));
    }
  }
  return options;
}

function printResults(results, write) {
  const counts = results.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  console.log(`\nReport enrichment ${write ? 'write' : 'dry-run'}`);
  console.log('==============================');
  console.log(JSON.stringify(counts, null, 2));
  for (const row of results.filter((item) => item.status === 'would_update' || item.status === 'updated').slice(0, 30)) {
    console.log(`- #${row.id} ${row.company} | ${row.role} | ${row.status} | stack=${row.found.stack_count} | comp=${row.found.compensation}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const results = enrichExistingReports({ projectRoot, ...options });
  printResults(results, options.write);
}
