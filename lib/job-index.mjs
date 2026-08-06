import { existsSync, readFileSync, appendFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { canonicalUrl, jobIdentityFields, jobIndexRecord } from './job-identity.mjs';
import { normalizeWhitespace, todayISO } from './job-normalizer.mjs';

export function createEmptyJobLookup() {
  return {
    urls: new Map(),
    externalKeys: new Map(),
    fingerprints: new Map(),
    similarKeys: new Map(),
    companyRoleKeys: new Map(),
    descriptionHashes: new Map(),
    count: 0,
  };
}

export function addJobToLookup(lookup, job, extra = {}) {
  const record = jobIndexRecord(job, extra);
  addRecordToLookup(lookup, record);
  return record;
}

export function addRecordToLookup(lookup, record = {}) {
  if (!record || typeof record !== 'object') return;
  const normalized = normalizeRecord(record);
  let added = false;
  added = put(lookup.urls, normalized.canonical_url, normalized) || added;
  added = put(lookup.externalKeys, normalized.external_key, normalized) || added;
  added = put(lookup.fingerprints, normalized.fingerprint, normalized) || added;
  added = put(lookup.similarKeys, normalized.similar_key, normalized) || added;
  added = put(lookup.companyRoleKeys, normalized.company_role_key, normalized) || added;
  added = put(lookup.descriptionHashes, normalized.description_hash, normalized) || added;
  if (added) lookup.count++;
}

export function findJobInLookup(lookup, job, options = {}) {
  const identity = jobIdentityFields(job);
  const checks = [
    ['url', lookup.urls, identity.canonical_url],
    ['external_id', lookup.externalKeys, identity.external_key],
    ['fingerprint', lookup.fingerprints, identity.fingerprint],
    ['similar_job', lookup.similarKeys, identity.similar_key],
  ];

  if (options.companyRole !== false) {
    checks.push(['company_role', lookup.companyRoleKeys, identity.company_role_key]);
  }
  if (options.descriptionHash === true) {
    checks.push(['description_hash', lookup.descriptionHashes, identity.description_hash]);
  }

  for (const [type, map, key] of checks) {
    if (key && map.has(key)) return { type, key, record: map.get(key) };
  }
  return null;
}

export function loadKnownJobLookup(root, options = {}) {
  const lookup = createEmptyJobLookup();
  if (options.includeJobIndex !== false) loadJsonlIndex(root, lookup);
  loadScanHistory(root, lookup);
  loadPipeline(root, lookup);
  loadReports(root, lookup);
  if (options.includeApplications !== false) loadApplications(root, lookup);
  return lookup;
}

export function rebuildJobIndex(root) {
  const lookup = loadKnownJobLookup(root, { includeJobIndex: false });
  const records = recordsFromLookup(lookup);
  const file = join(root, 'data', 'job-index.jsonl');
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf-8');
  return { file, count: records.length };
}

export function recordsFromLookup(lookup) {
  const records = new Map();
  for (const map of [
    lookup.fingerprints,
    lookup.externalKeys,
    lookup.urls,
    lookup.similarKeys,
    lookup.companyRoleKeys,
  ]) {
    for (const record of map.values()) {
      const normalized = normalizeRecord(record);
      const key = normalized.fingerprint || normalized.external_key || normalized.canonical_url || normalized.similar_key || normalized.company_role_key;
      if (key && !records.has(key)) records.set(key, normalized);
    }
  }
  return [...records.values()];
}

export function appendJobIndex(root, entries, options = {}) {
  const file = join(root, 'data', 'job-index.jsonl');
  const existing = loadKnownJobLookup(root);
  const rows = [];

  for (const entry of entries) {
    const job = entry.job || entry;
    const record = jobIndexRecord(job, {
      status: entry.status || statusFromEntry(entry),
      date: todayISO(),
      score: entry.evaluation?.score,
      recommendation: entry.evaluation?.recommendation,
    });
    if (!record.fingerprint && !record.canonical_url) continue;
    if (findRecordInLookup(existing, record)) continue;
    addRecordToLookup(existing, record);
    rows.push(JSON.stringify(record));
  }

  if (rows.length === 0) return 0;
  if (!existsSync(file)) writeFileSync(file, '', 'utf-8');
  appendFileSync(file, `${rows.join('\n')}\n`, 'utf-8');
  return rows.length;
}

function loadJsonlIndex(root, lookup) {
  const file = join(root, 'data', 'job-index.jsonl');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const text = line.trim();
    if (!text) continue;
    try {
      addRecordToLookup(lookup, JSON.parse(text));
    } catch {
      // verify-pipeline reports malformed index records; the scanner keeps going.
    }
  }
}

function loadScanHistory(root, lookup) {
  const file = join(root, 'data', 'scan-history.tsv');
  if (!existsSync(file)) return;

  const lines = readFileSync(file, 'utf-8').split('\n').slice(1);
  for (const line of lines) {
    const [link, firstSeen, source, title, company, status] = line.split('\t');
    if (!link) continue;
    addJobToLookup(lookup, {
      link,
      first_seen: firstSeen,
      source,
      title,
      company,
    }, { status: status || 'seen', first_seen: firstSeen });
  }
}

function loadPipeline(root, lookup) {
  const file = join(root, 'data', 'pipeline.md');
  if (!existsSync(file)) return;
  const content = readFileSync(file, 'utf-8');
  for (const line of content.split('\n')) {
    const url = line.match(/https?:\/\/[^\s|)\]]+/)?.[0];
    if (!url) continue;
    const parts = line.split('|').map((part) => part.trim());
    addJobToLookup(lookup, {
      link: cleanUrl(url),
      company: parts[2] || '',
      title: parts[3] || '',
      source: 'pipeline',
    }, { status: 'pipeline' });
  }
}

function loadReports(root, lookup) {
  const dir = join(root, 'reports');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.md'))) {
    const content = readFileSync(join(dir, name), 'utf-8');
    const link = content.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/)?.[1];
    const company = content.match(/\*\*Company:\*\*\s*(.+)/)?.[1];
    const title = content.match(/\*\*Role:\*\*\s*(.+)/)?.[1];
    if (!link && !company && !title) continue;
    addJobToLookup(lookup, {
      link: cleanUrl(link || ''),
      company: normalizeWhitespace(company || ''),
      title: normalizeWhitespace(title || ''),
      source: 'report',
    }, { status: 'report' });
  }
}

function loadApplications(root, lookup) {
  const file = join(root, 'data', 'applications.md');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((part) => part.trim());
    const id = Number(parts[1]);
    if (!Number.isFinite(id) || parts.length < 5) continue;
    addJobToLookup(lookup, {
      company: parts[3],
      title: parts[4],
      source: 'applications',
    }, { status: 'application' });
  }
}

function normalizeRecord(record) {
  const canonical_url = canonicalUrl(record.canonical_url || record.link || record.url || '');
  return {
    ...record,
    canonical_url,
    external_key: normalizeWhitespace(record.external_key || ''),
    fingerprint: normalizeWhitespace(record.fingerprint || record.external_key || record.similar_key || canonical_url || ''),
    similar_key: normalizeWhitespace(record.similar_key || ''),
    company_role_key: normalizeWhitespace(record.company_role_key || ''),
    description_hash: normalizeWhitespace(record.description_hash || ''),
  };
}

function findRecordInLookup(lookup, record) {
  const normalized = normalizeRecord(record);
  return Boolean(
    (normalized.canonical_url && lookup.urls.has(normalized.canonical_url)) ||
    (normalized.external_key && lookup.externalKeys.has(normalized.external_key)) ||
    (normalized.fingerprint && lookup.fingerprints.has(normalized.fingerprint)) ||
    (normalized.similar_key && lookup.similarKeys.has(normalized.similar_key))
  );
}

function put(map, key, record) {
  if (!key) return false;
  if (map.has(key)) return false;
  map.set(key, record);
  return true;
}

function statusFromEntry(entry) {
  if (entry.quality && entry.quality.passed === false) return 'skipped_low_quality';
  if (entry.evaluation?.recommendation === 'discard') return 'skipped_low_fit';
  if (entry.evaluation) return 'evaluated';
  return 'seen';
}

function cleanUrl(value) {
  return String(value || '').replace(/[.,;]+$/, '');
}
