import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-file.mjs';

const HEADER = 'captured_at\tdiscovered_via\tcanonical_url\tcompany\ttitle\tstatus\tquality_score\tfit_score';
const FIELDS = HEADER.split('\t');
const STATUSES = new Set(['evaluated', 'skipped_low_fit', 'skipped_low_quality']);
const LANE_ALIASES = new Map([
  ['linkedin', 'linkedin'],
  ['indeed', 'indeed'],
  ['iefp', 'iefp'],
  ['iefp online', 'iefp'],
  ['itjobs', 'itjobs'],
  ['it jobs', 'itjobs'],
  ['net empregos', 'net_empregos'],
  ['netempregos', 'net_empregos'],
]);

export function sourceCapturePath(projectRoot) {
  return join(projectRoot, 'data', 'source-captures.tsv');
}

export function normalizeDiscoveryLane(value) {
  const key = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return LANE_ALIASES.get(key) || '';
}

export function deriveSourceCaptureStatus({ quality = {}, evaluation = null, minScore = 60 } = {}) {
  if (quality?.passed !== true) return 'skipped_low_quality';
  if (!evaluation) return 'skipped_low_fit';
  if (evaluation.recommendation === 'discard') return 'skipped_low_fit';
  return Number(evaluation.score) >= Number(minScore) ? 'evaluated' : 'skipped_low_fit';
}

export function isQualifiedSourceCapture(capture) {
  return String(capture?.status || '').trim().toLowerCase() === 'evaluated';
}

export function loadSourceCaptures(projectRoot) {
  return readStore(sourceCapturePath(projectRoot));
}

export function recordSourceCapture(options = {}) {
  const file = sourceCapturePath(options.projectRoot);
  const capture = buildCapture(options);
  const existing = readStore(file);
  const key = captureKey(capture);
  const replaced = existing.captures.some((row) => captureKey(row) === key);
  const retained = existing.captures.filter((row) => captureKey(row) !== key);

  const content = [
    HEADER,
    ...existing.malformed_lines,
    ...retained.map(serializeCapture),
    serializeCapture(capture),
    '',
  ].join('\n');
  writeFileAtomic(file, content);

  return {
    recorded: true,
    replaced,
    file,
    capture,
    warnings: existing.warnings,
  };
}

function readStore(file) {
  if (!existsSync(file)) return { captures: [], warnings: [], malformed_lines: [] };

  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line !== '');
  if (lines.length === 0) return { captures: [], warnings: [], malformed_lines: [] };

  const warnings = [];
  const malformedLines = [];
  const captures = [];
  const hasExpectedHeader = lines[0] === HEADER;
  if (!hasExpectedHeader) {
    warnings.push('source-captures header is invalid; rows were ignored.');
    return { captures, warnings, malformed_lines: lines };
  }

  for (const [index, line] of lines.slice(1).entries()) {
    const parsed = parseCapture(line);
    if (parsed) {
      captures.push(parsed);
    } else {
      warnings.push(`ignored malformed source-capture row ${index + 2}.`);
      malformedLines.push(line);
    }
  }

  return { captures, warnings, malformed_lines: malformedLines };
}

function parseCapture(line) {
  const values = String(line || '').split('\t');
  if (values.length !== FIELDS.length) return null;
  const raw = Object.fromEntries(FIELDS.map((field, index) => [field, values[index]]));

  try {
    return buildCapture({
      capturedAt: raw.captured_at,
      discoveredVia: raw.discovered_via,
      canonicalUrl: raw.canonical_url,
      company: raw.company,
      title: raw.title,
      status: raw.status,
      qualityScore: raw.quality_score,
      fitScore: raw.fit_score,
    });
  } catch {
    return null;
  }
}

function buildCapture(options = {}) {
  const discoveredVia = normalizeDiscoveryLane(options.discoveredVia);
  if (!discoveredVia) throw new Error('Discovery provenance requires a supported --discovered-via lane.');

  const capturedAt = validTimestamp(options.capturedAt || new Date().toISOString());
  if (!capturedAt) throw new Error('Discovery provenance requires a valid capture timestamp.');

  const canonicalUrl = canonicalHttpUrl(options.canonicalUrl);
  if (!canonicalUrl) throw new Error('Discovery provenance requires a valid official HTTP(S) URL.');

  const status = String(options.status || '').trim().toLowerCase();
  if (!STATUSES.has(status)) throw new Error('Discovery provenance requires a supported capture status.');

  return {
    captured_at: capturedAt,
    discovered_via: discoveredVia,
    canonical_url: canonicalUrl,
    company: cleanCell(options.company),
    title: cleanCell(options.title),
    status,
    quality_score: formatNumber(options.qualityScore),
    fit_score: formatNumber(options.fitScore),
  };
}

function serializeCapture(capture) {
  return FIELDS.map((field) => cleanCell(capture[field])).join('\t');
}

function captureKey(capture) {
  return `${capture.discovered_via}\u0000${capture.canonical_url}`;
}

function validTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString();
}

function canonicalHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function cleanCell(value) {
  return String(value ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatNumber(value) {
  if (value === '' || value === undefined || value === null) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : '';
}
