#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runScanAndRank } from './scan-and-rank.mjs';
import { normalizeText, normalizeWhitespace, stripHtml, todayISO } from './lib/job-normalizer.mjs';
import { safeFetch } from './lib/network/safe-fetch.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'LeagleJob/1.4 (based on Career-Ops; open public job boards; no api keys)';

const EARLY_TERMS = [
  'intern',
  'internship',
  'trainee',
  'graduate',
  'junior',
  'entry level',
  'entry-level',
  'apprentice',
  'working student',
  'student',
  'estagio',
  'estagiario',
];

const TECH_TERMS = [
  'software',
  'developer',
  'engineer',
  'frontend',
  'front-end',
  'backend',
  'back-end',
  'full stack',
  'full-stack',
  'qa',
  'quality assurance',
  'tester',
  'automation',
  'data',
  'python',
  'javascript',
  'typescript',
  'react',
  'node',
  'api',
  'cloud',
  'platform',
  'technical support engineer',
];

const NEGATIVE_TERMS = [
  'senior',
  'sr.',
  'staff',
  'principal',
  'lead',
  'manager',
  'director',
  'head of',
  'sales',
  'account executive',
  'marketing',
  'seo',
  'content',
  'brand',
  'social media',
  'legal',
  'finance',
  'hr',
  'recruit',
  'people',
  'nurse',
  'physician',
  'therapist',
  'customer success',
  'virtual assistant',
  'administrative',
  'assistant',
  'crypto trader',
  'designer',
  'illustrator',
  'interface designer',
  'video editor',
];

export async function runOpenJobBoardSearch(options = {}) {
  const root = options.projectRoot || projectRoot;
  const maxPerSource = Number(options.maxPerSource || 80);
  const maxCandidates = Number(options.maxCandidates || 180);
  const candidates = [];
  const errors = [];
  const sourceStats = [];
  const seen = new Set();

  for (const source of sources()) {
    if (candidates.length >= maxCandidates) break;
    const before = candidates.length;
    try {
      const jobs = await source.fetch({ maxPerSource, timeoutMs: Number(options.timeoutMs || 20000) });
      for (const job of jobs) {
        if (candidates.length >= maxCandidates) break;
        if (!isRelevant(job)) continue;
        const key = candidateKey(job);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(job);
      }
    } catch (error) {
      errors.push({ source: source.name, error: error.message });
    }
    sourceStats.push({
      source: source.name,
      type: 'open_job_board_api',
      discovered: Math.max(0, candidates.length - before),
      accepted: Math.max(0, candidates.length - before),
      skipped: 0,
    });
  }

  const snapshot = {
    scanned_at: new Date().toISOString(),
    scan_mode: 'open-job-board-search',
    candidates,
    skipped: [],
    errors,
    source_stats: sourceStats,
  };

  const snapshotPath = writeSnapshot(root, snapshot, options);
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
    snapshot_path: snapshotPath,
    errors,
    rank,
  };
}

function sources() {
  return [
    { name: 'Arbeitnow', fetch: fetchArbeitnow },
    { name: 'RemoteOK', fetch: fetchRemoteOk },
    { name: 'Jobicy Dev', fetch: (options) => fetchJobicy({ industry: 'dev' }, options) },
    { name: 'Jobicy JavaScript', fetch: (options) => fetchJobicy({ tag: 'javascript' }, options) },
    { name: 'Jobicy Python', fetch: (options) => fetchJobicy({ tag: 'python' }, options) },
    { name: 'Remotive Software', fetch: (options) => fetchRemotive('software dev', options) },
    { name: 'Remotive QA', fetch: (options) => fetchRemotive('qa', options) },
  ];
}

async function fetchArbeitnow({ maxPerSource, timeoutMs }) {
  const json = await fetchJson('https://www.arbeitnow.com/api/job-board-api', timeoutMs);
  return asArray(json.data).slice(0, maxPerSource).map((job) => ({
    title: clean(job.title),
    company: clean(job.company_name),
    location: clean(job.location || (job.remote ? 'Remote' : 'a confirmar')),
    work_mode: job.remote ? 'Remote' : 'a confirmar',
    link: clean(job.url),
    description: clean(stripHtml(job.description || '')),
    source: 'Arbeitnow open_api',
    external_id: job.slug ? `arbeitnow:${job.slug}` : '',
    date_posted: job.created_at ? new Date(Number(job.created_at) * 1000).toISOString().slice(0, 10) : '',
    employment_type: asArray(job.job_types).join(', '),
    stack_required: asArray(job.tags),
  }));
}

async function fetchRemoteOk({ maxPerSource, timeoutMs }) {
  const json = await fetchJson('https://remoteok.com/api', timeoutMs);
  return asArray(json).filter((job) => job && job.id).slice(0, maxPerSource).map((job) => ({
    title: clean(job.position),
    company: clean(job.company),
    location: clean([job.location, job.country].filter(Boolean).join(' / ') || 'Remote'),
    work_mode: 'Remote',
    link: clean(job.url || (job.slug ? `https://remoteok.com/remote-jobs/${job.slug}` : '')),
    description: clean(stripHtml(job.description || '')),
    source: 'RemoteOK open_api',
    external_id: `remoteok:${job.id}`,
    date_posted: job.date ? String(job.date).slice(0, 10) : '',
    employment_type: '',
    stack_required: asArray(job.tags),
  }));
}

async function fetchJobicy(params, { maxPerSource, timeoutMs }) {
  const query = new URLSearchParams({ count: String(maxPerSource), ...params }).toString();
  const url = `https://jobicy.com/api/v2/remote-jobs?${query}`;
  const json = await fetchJson(url, timeoutMs);
  return asArray(json.jobs).map((job) => ({
    title: clean(job.jobTitle),
    company: clean(job.companyName),
    location: clean([job.jobGeo, job.jobLevel].filter(Boolean).join(' / ') || 'Remote'),
    work_mode: 'Remote',
    link: clean(job.url),
    description: clean(stripHtml(job.jobExcerpt || job.jobDescription || '')),
    source: `Jobicy ${Object.values(params).join('-')} open_api`,
    external_id: job.id ? `jobicy:${job.id}` : '',
    date_posted: job.pubDate ? String(job.pubDate).slice(0, 10) : '',
    employment_type: clean(job.jobType || ''),
    stack_required: asArray(job.jobIndustry),
  }));
}

async function fetchRemotive(query, { maxPerSource, timeoutMs }) {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
  const json = await fetchJson(url, timeoutMs);
  return asArray(json.jobs).slice(0, maxPerSource).map((job) => ({
    title: clean(job.title),
    company: clean(job.company_name),
    location: clean(job.candidate_required_location || 'Remote'),
    work_mode: 'Remote',
    link: clean(job.url),
    description: clean(stripHtml(job.description || '')),
    source: `Remotive ${query} open_api`,
    external_id: job.id ? `remotive:${job.id}` : '',
    date_posted: job.publication_date ? String(job.publication_date).slice(0, 10) : '',
    employment_type: clean(job.job_type || ''),
    stack_required: asArray(job.tags),
  }));
}

function isRelevant(job) {
  const title = normalizeText(job.title || '');
  const text = normalizeText(`${job.title || ''} ${job.location || ''} ${job.description || ''} ${asArray(job.stack_required).join(' ')}`);
  if (!job.title || !job.company || !job.link) return false;
  if (NEGATIVE_TERMS.some((term) => hasTerm(title, term))) return false;
  const early = EARLY_TERMS.some((term) => hasTerm(title, term) || hasTerm(text, term));
  const technical = TECH_TERMS.some((term) => hasTerm(title, term));
  return early && technical;
}

function candidateKey(job) {
  return normalizeText(`${job.company || ''}|${job.title || ''}|${job.link || ''}`).replace(/[^a-z0-9]+/g, ' ').trim();
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

async function fetchJson(url, timeoutMs) {
  const response = await safeFetch(url, {
    timeoutMs,
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
  const outputDir = resolve(root, options.outputDir || join('output', 'open-job-board-search'));
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, `open-job-board-search-${todayISO()}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
  return path;
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    writeLimit: 10,
    maxCandidates: 180,
    maxPerSource: 80,
    minScore: undefined,
    outputDir: '',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--write') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--write-limit') options.writeLimit = Number(argv[++index] ?? options.writeLimit);
    else if (arg === '--max-candidates') options.maxCandidates = Number(argv[++index] || options.maxCandidates);
    else if (arg === '--max-per-source') options.maxPerSource = Number(argv[++index] || options.maxPerSource);
    else if (arg === '--min-score') options.minScore = Number(argv[++index]);
    else if (arg === '--out') options.outputDir = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printResult(result) {
  console.log('\nOpen job board search');
  console.log('=====================');
  console.log(`Candidates found: ${result.candidates_found}`);
  console.log(`Snapshot: ${relativePath(result.snapshot_path)}`);
  console.log(`API errors: ${result.errors.length}`);
  for (const error of result.errors.slice(0, 8)) console.log(`- ${error.source}: ${error.error}`);

  console.log(`\nOfficial ranking: ${result.rank.scanned} scanned, ${result.rank.selected.length} selected.`);
  for (const item of result.rank.ranked.slice(0, 20)) {
    console.log(`${item.evaluation.score >= 60 ? '*' : '-'} ${item.evaluation.score}/100 ${item.evaluation.recommendation.toUpperCase()} | ${item.job.company} | ${item.job.title}`);
  }

  if (result.rank.written?.length) {
    console.log('\nWritten to dashboard:');
    for (const item of result.rank.written) console.log(`- #${item.id} ${item.company} | ${item.title} | ${item.score}/100`);
  }
  if (result.rank.write_skipped?.length) {
    console.log('\nSkipped dashboard writes:');
    for (const item of result.rank.write_skipped) console.log(`- ${item.company} | ${item.title} | ${item.reason}`);
  }
  if (result.dry_run) console.log('\nDry-run: no dashboard entries or reports were written.');
}

function printHelp() {
  console.log(`
Usage:
  node open-job-board-search.mjs --dry-run
  node open-job-board-search.mjs --write --write-limit 10

Options:
  --dry-run              Search and score without writing dashboard entries. Default.
  --write                Write selected jobs to reports/dashboard through official scan-and-rank.
  --write-limit <n>      Maximum dashboard writes. Default: 10.
  --max-candidates <n>   Maximum relevant candidates to score. Default: 180.
  --max-per-source <n>   Maximum raw jobs per source. Default: 80.
  --min-score <n>        Override official write threshold.
  --out <path>           Snapshot output directory.
`);
}

function clean(value) {
  return normalizeWhitespace(value || '');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function relativePath(file) {
  return String(file || '').replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  runOpenJobBoardSearch(options)
    .then(printResult)
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
