#!/usr/bin/env node

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadYamlFile } from './lib/config-loader.mjs';
import { runScanAndRank } from './scan-and-rank.mjs';
import { normalizeText, normalizeWhitespace, stripHtml, todayISO } from './lib/job-normalizer.mjs';
import { safeFetch } from './lib/network/safe-fetch.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'LeagleJob/1.4 (based on Career-Ops; structured deep search; public job APIs only)';

const TITLE_POSITIVE = [
  'intern',
  'internship',
  'estagio',
  'estagiario',
  'trainee',
  'graduate',
  'junior',
  'entry level',
  'apprentice',
  'student',
  'early career',
  'associate',
];

const ROLE_POSITIVE = [
  'software',
  'developer',
  'engineer',
  'backend',
  'frontend',
  'full stack',
  'full-stack',
  'fullstack',
  'web',
  'qa',
  'quality',
  'tester',
  'automation',
  'data',
  'analytics',
  'ai',
  'machine learning',
  'ml',
  'computer vision',
  'research',
  'infrastructure',
  'platform',
  'cloud',
  'technical',
  'support engineer',
];

const NEGATIVE = [
  'senior',
  'staff',
  'principal',
  'lead',
  'manager',
  'director',
  'sales',
  'marketing',
  'brand',
  'design',
  'legal',
  'finance',
  'account executive',
  'customer success',
  'people',
  'hr',
  'recruit',
  'communications',
  'content',
  'general application',
  'executive assistant',
  'operations',
  'claims',
  'anlagenbetreuer',
  'banking operations',
  'culinary',
  'supply planning',
  'growth operator',
  'risk associate',
  'product management',
  'kyco',
  'german speaking',
  'us government',
  'defense tech',
  'security clearance',
];

const BROAD_NEGATIVE = [
  'manager',
  'director',
  'sales',
  'marketing',
  'brand',
  'design',
  'legal',
  'finance',
  'account executive',
  'customer success',
  'people',
  'hr',
  'recruit',
  'communications',
  'content',
  'general application',
  'executive assistant',
  'operations',
  'claims',
  'anlagenbetreuer',
  'banking operations',
  'culinary',
  'supply planning',
  'growth operator',
  'risk associate',
  'product management',
  'kyco',
  'german speaking',
  'us government',
  'defense tech',
  'security clearance',
];

export async function runStructuredDeepSearch(options = {}) {
  const root = options.projectRoot || projectRoot;
  const portals = loadYamlFile(join(root, 'portals.yml'));
  const companies = asArray(portals.tracked_companies).filter((company) => company.enabled !== false);
  const candidates = [];
  const seen = new Set();
  const errors = [];
  const sourceStats = [];
  const perSourceLimit = Number(options.perSourceLimit || 6);
  const maxCandidates = Number(options.maxCandidates || 120);

  for (const company of companies) {
    if (candidates.length >= maxCandidates) break;
    const sourceCandidates = [];
    try {
      const extracted = await fetchCompanyJobs(company, { timeoutMs: Number(options.timeoutMs || 16000) });
      for (const job of extracted) {
        if (sourceCandidates.length >= perSourceLimit) break;
        if (!isRelevant(job, options)) continue;
        const key = candidateKey(job);
        if (seen.has(key)) continue;
        seen.add(key);
        sourceCandidates.push(job);
      }
    } catch (error) {
      errors.push({ source: company.name || 'unknown', error: error.message });
    }

    candidates.push(...sourceCandidates);
    if (sourceCandidates.length > 0 || options.verbose) {
      sourceStats.push({
        source: company.name || 'unknown',
        type: detectCompanyType(company),
        discovered: sourceCandidates.length,
        accepted: sourceCandidates.length,
        skipped: 0,
      });
    }
  }

  const snapshot = {
    scanned_at: new Date().toISOString(),
    scan_mode: 'structured-deep-search',
    candidates: candidates.slice(0, maxCandidates),
    skipped: [],
    errors,
    source_stats: sourceStats,
  };

  const outputPath = writeSnapshot(root, snapshot, options);
  const rank = await runScanAndRank({
    projectRoot: root,
    dryRun: Boolean(options.dryRun),
    snapshot,
    writeLimit: Number(options.writeLimit ?? 10),
    minScore: options.minScore,
  });

  return {
    dry_run: Boolean(options.dryRun),
    candidates_found: candidates.length,
    snapshot_path: outputPath,
    errors,
    rank,
  };
}

async function fetchCompanyJobs(company, options) {
  if (company.api && normalizeText(company.api).includes('greenhouse')) {
    return fetchGreenhouse(company, company.api, options);
  }

  const url = String(company.careers_url || '');
  const leverSlug = url.match(/jobs\.lever\.co\/([^/?#]+)/i)?.[1];
  if (leverSlug) return fetchLever(company, leverSlug, options);

  const ashbySlug = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i)?.[1];
  if (ashbySlug) return fetchAshby(company, ashbySlug, options);

  return [];
}

async function fetchGreenhouse(company, api, options) {
  const json = await fetchJson(api.includes('?') ? api : `${api}?content=true`, options);
  return asArray(json.jobs).map((job) => normalizeApiJob({
    company,
    title: job.title,
    link: job.absolute_url,
    location: asArray(job.offices).map((office) => office.name).join(' / ') || job.location?.name || '',
    description: stripHtml(job.content || ''),
    external_id: `greenhouse:${job.id}`,
    source: `${company.name} greenhouse_api`,
  }));
}

async function fetchLever(company, slug, options) {
  const json = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`, options);
  return asArray(json).map((job) => normalizeApiJob({
    company,
    title: job.text,
    link: job.hostedUrl || job.applyUrl,
    location: job.categories?.location || '',
    description: stripHtml([job.descriptionPlain, job.additionalPlain].filter(Boolean).join('\n')),
    external_id: `lever:${job.id}`,
    source: `${company.name} lever_api`,
  }));
}

async function fetchAshby(company, slug, options) {
  const json = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, options);
  return asArray(json.jobs).map((job) => normalizeApiJob({
    company,
    title: job.title,
    link: job.jobUrl || `https://jobs.ashbyhq.com/${slug}/${job.id}`,
    location: formatLocation([job.location, job.secondaryLocations]),
    description: stripHtml([job.descriptionHtml, job.descriptionPlain].filter(Boolean).join('\n')),
    external_id: `ashby:${job.id}`,
    source: `${company.name} ashby_api`,
  }));
}

function normalizeApiJob({ company, title, link, location, description, external_id, source }) {
  return {
    title: normalizeWhitespace(title || ''),
    company: normalizeWhitespace(company.name || ''),
    location: normalizeWhitespace(location || ''),
    work_mode: inferWorkMode(`${title} ${location} ${description}`),
    link: normalizeWhitespace(link || ''),
    description: normalizeWhitespace(description || ''),
    source,
    external_id,
    date_posted: '',
    valid_through: '',
    employment_type: '',
  };
}

function isRelevant(job, options = {}) {
  const title = normalizeText(job.title || '');
  const text = normalizeText(`${job.title || ''} ${job.location || ''} ${job.description || ''}`);
  if (!job.link || !job.title) return false;
  const negativeTerms = options.broad ? BROAD_NEGATIVE : NEGATIVE;
  if (negativeTerms.some((term) => hasTerm(title, term))) return false;
  const hasEarlySignal = TITLE_POSITIVE.some((term) => hasTerm(title, term));
  const hasRoleSignal = ROLE_POSITIVE.some((term) => hasTerm(title, term));
  if (options.broad) return hasRoleSignal || ROLE_POSITIVE.some((term) => hasTerm(text, term));
  return hasEarlySignal && hasRoleSignal;
}

function candidateKey(job) {
  return normalizeText(`${job.company || ''}|${job.title || ''}`).replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasTerm(text, term) {
  const normalizedTerm = normalizeText(term).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalizedTerm) return false;
  const pattern = normalizedTerm
    .split(' ')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^a-z0-9]+');
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`).test(text);
}

function formatLocation(value) {
  return asArray(value)
    .flatMap((item) => asArray(item))
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      return item.name || item.location || item.city || item.country || '';
    })
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join(' / ');
}

async function fetchJson(url, options) {
  const response = await safeFetch(url, {
    timeoutMs: Number(options.timeoutMs || 16000),
    requireHttps: true,
    maxResponseBytes: 8 * 1024 * 1024,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json,text/plain,*/*',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function writeSnapshot(root, snapshot, options) {
  const outputDir = resolve(root, options.outputDir || join('output', 'structured-deep-search'));
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, `structured-deep-search-${todayISO()}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
  return path;
}

function inferWorkMode(value) {
  const text = normalizeText(value);
  if (text.includes('remote')) return 'Remote';
  if (text.includes('hybrid') || text.includes('hibrido')) return 'Hybrid';
  if (text.includes('onsite') || text.includes('on-site') || text.includes('presencial')) return 'Onsite';
  return 'a confirmar';
}

function detectCompanyType(company) {
  if (company.api && normalizeText(company.api).includes('greenhouse')) return 'greenhouse_api';
  if (/jobs\.lever\.co/i.test(company.careers_url || '')) return 'lever_api';
  if (/jobs\.ashbyhq\.com/i.test(company.careers_url || '')) return 'ashby_api';
  return 'structured_api';
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    writeLimit: 10,
    maxCandidates: 120,
    perSourceLimit: 6,
    minScore: undefined,
    outputDir: '',
    verbose: false,
    broad: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--write') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--write-limit') options.writeLimit = Number(argv[++index] ?? options.writeLimit);
    else if (arg === '--max-candidates') options.maxCandidates = Number(argv[++index] || options.maxCandidates);
    else if (arg === '--per-source-limit') options.perSourceLimit = Number(argv[++index] || options.perSourceLimit);
    else if (arg === '--min-score') options.minScore = Number(argv[++index]);
    else if (arg === '--out') options.outputDir = argv[++index] || '';
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--broad') options.broad = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printResult(result) {
  console.log('\nStructured deep search');
  console.log('======================');
  console.log(`Candidates found: ${result.candidates_found}`);
  console.log(`Snapshot: ${relativePath(result.snapshot_path)}`);
  console.log(`API errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const error of result.errors.slice(0, 8)) {
      console.log(`- ${error.source}: ${error.error}`);
    }
  }

  console.log(`\nOfficial ranking: ${result.rank.scanned} scanned, ${result.rank.selected.length} selected.`);
  for (const item of result.rank.ranked.slice(0, 20)) {
    console.log(`${item.evaluation.score >= 60 ? '*' : '-'} ${item.evaluation.score}/100 ${item.evaluation.recommendation.toUpperCase()} | ${item.job.company} | ${item.job.title}`);
  }

  if (result.rank.written?.length) {
    console.log('\nWritten to dashboard:');
    for (const item of result.rank.written) {
      console.log(`- #${item.id} ${item.company} | ${item.title} | ${item.score}/100`);
    }
  }
  if (result.dry_run) console.log('\nDry-run: no dashboard entries or reports were written.');
}

function printHelp() {
  console.log(`
Usage:
  node structured-deep-search.mjs --dry-run
  node structured-deep-search.mjs --write --write-limit 10

Options:
  --dry-run              Search and score without writing dashboard entries. Default.
  --write                Write selected jobs to reports/dashboard through official scan-and-rank.
  --write-limit <n>      Maximum dashboard writes. Default: 10.
  --max-candidates <n>   Maximum relevant API candidates to score. Default: 120.
  --per-source-limit <n> Maximum relevant jobs per company/source. Default: 6.
  --min-score <n>        Override official write threshold.
  --out <path>           Snapshot output directory.
  --verbose              Include empty source stats.
  --broad                Audit broader technical roles, not just junior/intern titles.
`);
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
  runStructuredDeepSearch(options)
    .then(printResult)
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
