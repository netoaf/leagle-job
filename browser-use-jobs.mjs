#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadYamlFile } from './lib/config-loader.mjs';
import { findJobInLookup, loadKnownJobLookup, createEmptyJobLookup, addJobToLookup } from './lib/job-index.mjs';
import { normalizeText, normalizeWhitespace, stripHtml, todayISO } from './lib/job-normalizer.mjs';
import { safeFetch } from './lib/network/safe-fetch.mjs';
import { runScanAndRank } from './scan-and-rank.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HTML_PATH = '..\\..\\lisbon-tech-junior-brief.html';

export async function runBrowserUseJobs(options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadBrowserUseConfig(root);
  const outputDir = resolve(root, options.outputDir || config.integration?.output_dir || join('output', 'browser-use'));
  const imported = options.cloud
    ? await runCloudSearch(config, options)
    : importFromHtml(resolve(root, options.fromHtml || DEFAULT_HTML_PATH));
  const deduped = dedupeCandidates(root, imported.candidates);
  const snapshot = buildSnapshot(imported, deduped.newCandidates);
  const snapshotPath = join(outputDir, `browser-use-candidates-${todayISO()}.json`);
  const result = {
    mode: options.cloud ? 'cloud' : 'html',
    source: imported.source,
    found: imported.candidates.length,
    new_candidates: deduped.newCandidates.length,
    skipped_known: deduped.skippedKnown.length,
    skipped_duplicate: deduped.skippedDuplicate.length,
    snapshot_path: snapshotPath,
    rank: null,
  };

  if (!options.dryRun) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  if (options.rank || options.dashboard) {
    result.rank = await runScanAndRank({
      projectRoot: root,
      candidates: deduped.newCandidates,
      dryRun: !options.dashboard,
      minScore: options.minScore ?? config.integration?.default_min_score,
      writeLimit: options.writeLimit ?? config.integration?.default_write_limit,
      includeSeen: false,
    });
  }

  return result;
}

function loadBrowserUseConfig(root) {
  const file = join(root, 'config', 'browser-use.yml');
  return existsSync(file) ? loadYamlFile(file) : {};
}

function importFromHtml(file) {
  if (!existsSync(file)) {
    throw new Error(`Browser Use HTML report not found: ${file}`);
  }

  const html = readFileSync(file, 'utf-8');
  const rows = [...html.matchAll(/<tr\s+class=["']row["'][^>]*>([\s\S]*?)<\/tr>/gi)];
  const candidates = [];

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 9) continue;
    const link = cells[8].match(/href=["']([^"']+)["']/i)?.[1] || '';
    const title = cleanCell(cells[1]);
    const company = cleanCell(cells[2]);
    const location = cleanCell(cells[3]);
    const workMode = cleanCell(cells[4]);
    const stack = splitStack(cleanCell(cells[5]));
    const suitability = cleanCell(cells[6]);
    const browserScore = Number(cleanCell(cells[7]).match(/\d+(\.\d+)?/)?.[0] || 0);

    if (!title || !company || !link) continue;
    candidates.push({
      title,
      company,
      location: location || 'a confirmar',
      work_mode: workMode || 'a confirmar',
      link,
      description: buildDescription({ suitability, stack, browserScore, source: basename(file) }),
      source: `Browser Use HTML: ${basename(file)}`,
      compensation: compensationSignal(suitability),
      stack_required: stack,
      browser_use_score: browserScore,
      application_language: inferApplicationLanguage({ location, link }),
    });
  }

  return {
    source: file,
    candidates,
  };
}

async function runCloudSearch(config, options) {
  const apiKey = process.env.BROWSER_USE_API_KEY;
  if (!apiKey) {
    throw new Error('BROWSER_USE_API_KEY is not set. Set it in your shell; never store it in the repo.');
  }

  const api = config.api || {};
  const defaults = config.search_defaults || {};
  const baseUrl = String(api.base_url || 'https://api.browser-use.com/api/v3').replace(/\/+$/, '');
  const maxJobs = Number(options.maxJobs || defaults.max_jobs || 20);
  const task = options.task || buildDefaultTask(defaults, maxJobs);
  const payload = {
    task,
    model: options.model || api.model || 'bu-mini',
    maxCostUsd: Number(options.maxCostUsd || api.max_cost_usd || 0.75),
    proxyCountryCode: options.proxyCountryCode || api.proxy_country_code || 'pt',
    outputSchema: browserUseOutputSchema(),
    keepAlive: false,
    enableRecording: false,
    agentmail: false,
    codeMode: false,
    cacheScript: true,
    autoHeal: true,
  };

  const created = await browserUseFetch(`${baseUrl}/sessions`, apiKey, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const session = await waitForSession(baseUrl, apiKey, created, {
    timeoutMs: Number(api.timeout_ms || 300000),
    pollIntervalMs: Number(api.poll_interval_ms || 5000),
  });
  const candidates = normalizeCloudOutput(session.output);

  return {
    source: `Browser Use Cloud session ${session.id || created.id || 'unknown'}`,
    candidates,
  };
}

async function waitForSession(baseUrl, apiKey, initial, options) {
  const startedAt = Date.now();
  let session = initial;
  while (Date.now() - startedAt < options.timeoutMs) {
    if (session?.output || session?.isTaskSuccessful === true || session?.isTaskSuccessful === false) return session;
    if (!session?.id) return session;
    await sleep(options.pollIntervalMs);
    session = await browserUseFetch(`${baseUrl}/sessions/${session.id}`, apiKey, { method: 'GET' });
  }
  throw new Error(`Browser Use session timed out after ${options.timeoutMs}ms`);
}

async function browserUseFetch(url, apiKey, options = {}) {
  const targetUrl = new URL(url);
  const response = await safeFetch(url, {
    ...options,
    requireHttps: true,
    allowedHosts: [targetUrl.hostname],
    maxRequestBytes: 1024 * 1024,
    maxResponseBytes: 2 * 1024 * 1024,
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Use-API-Key': apiKey,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Browser Use API ${response.status}: ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  return parsed;
}

function dedupeCandidates(root, candidates) {
  const known = loadKnownJobLookup(root);
  const run = createEmptyJobLookup();
  const newCandidates = [];
  const skippedKnown = [];
  const skippedDuplicate = [];

  for (const candidate of candidates.map(normalizeCandidate).filter((job) => job.title && job.company && job.link)) {
    const knownMatch = findJobInLookup(known, candidate, { companyRole: true });
    if (knownMatch) {
      skippedKnown.push({ job: candidate, reason: `known_${knownMatch.type}` });
      continue;
    }

    const runMatch = findJobInLookup(run, candidate, { companyRole: true });
    if (runMatch) {
      skippedDuplicate.push({ job: candidate, reason: `duplicate_${runMatch.type}` });
      continue;
    }

    newCandidates.push(candidate);
    addJobToLookup(run, candidate, { status: 'browser_use_candidate' });
  }

  return { newCandidates, skippedKnown, skippedDuplicate };
}

function buildSnapshot(imported, candidates) {
  return {
    scanned_at: new Date().toISOString(),
    scan_mode: 'browser-use-import',
    source: imported.source,
    candidates,
    skipped: [],
    errors: [],
    source_stats: [
      {
        source: 'Browser Use',
        type: 'external_ai_radar',
        discovered: candidates.length,
        accepted: candidates.length,
        skipped: 0,
      },
    ],
  };
}

function normalizeCloudOutput(output) {
  const parsed = typeof output === 'string' ? safeJson(output) : output;
  const jobs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  return jobs.map((job) => normalizeCandidate({
    title: job.title,
    company: job.company,
    location: job.location,
    work_mode: job.work_mode,
    link: job.link,
    description: buildDescription({
      suitability: job.evidence || job.summary || job.reason || '',
      stack: job.stack_required || job.stack || [],
      browserScore: job.browser_use_score || 0,
      source: 'Browser Use Cloud',
    }),
    source: 'Browser Use Cloud',
    compensation: job.compensation || 'a confirmar',
    stack_required: Array.isArray(job.stack_required) ? job.stack_required : splitStack(String(job.stack || '')),
    application_language: job.application_language || inferApplicationLanguage(job),
    browser_use_score: Number(job.browser_use_score || 0),
  }));
}

function normalizeCandidate(job) {
  return {
    title: normalizeWhitespace(job.title),
    company: normalizeWhitespace(job.company),
    location: normalizeWhitespace(job.location || 'a confirmar'),
    work_mode: normalizeWhitespace(job.work_mode || 'a confirmar'),
    link: normalizeWhitespace(job.link),
    description: normalizeWhitespace(job.description || ''),
    source: normalizeWhitespace(job.source || 'Browser Use'),
    compensation: normalizeWhitespace(job.compensation || 'a confirmar'),
    stack_required: Array.isArray(job.stack_required) ? job.stack_required.map(normalizeWhitespace).filter(Boolean) : [],
    application_language: job.application_language || inferApplicationLanguage(job),
    browser_use_score: Number(job.browser_use_score || 0),
  };
}

function buildDefaultTask(defaults, maxJobs) {
  const sources = asArray(defaults.sources).join(', ');
  const mustInclude = asArray(defaults.must_include).join(', ');
  const avoid = asArray(defaults.avoid).join(', ');
  return `Search public job boards and company career pages for up to ${maxJobs} active junior/internship tech roles for a TGPSI student in Lisbon, Portugal. Prioritize Portuguese results, then English. Target: ${defaults.target_location || 'Portugal, Lisboa, remote Portugal'}. Sources to try: ${sources}. Prefer titles/signals: ${mustInclude}. Avoid: ${avoid}. Return only active jobs with direct URLs. Do not apply, do not log in, do not send emails.`;
}

function browserUseOutputSchema() {
  return {
    type: 'object',
    properties: {
      jobs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            company: { type: 'string' },
            location: { type: 'string' },
            work_mode: { type: 'string' },
            link: { type: 'string' },
            compensation: { type: 'string' },
            stack_required: { type: 'array', items: { type: 'string' } },
            evidence: { type: 'string' },
            browser_use_score: { type: 'number' },
            application_language: { type: 'string' },
          },
          required: ['title', 'company', 'link'],
        },
      },
    },
    required: ['jobs'],
  };
}

function cleanCell(html) {
  return normalizeWhitespace(repairMojibake(stripHtml(html).replace(/&mdash;|&#8212;/g, '-')));
}

function splitStack(value) {
  return String(value || '')
    .split(/[,;/|]+/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean)
    .slice(0, 16);
}

function buildDescription({ suitability, stack, browserScore, source }) {
  const stackText = Array.isArray(stack) ? stack.join(', ') : String(stack || '');
  return normalizeWhitespace(repairMojibake([
    suitability,
    stackText ? `Stack/sinais: ${stackText}.` : '',
    browserScore ? `Score externo Browser Use: ${browserScore}/100; reavaliar sempre com scoring oficial Leagle Job.` : '',
    `Origem: ${source}.`,
  ].filter(Boolean).join(' ')));
}

function compensationSignal(value) {
  const text = normalizeText(value);
  if (text.includes('paid') || text.includes('iefp') || text.includes('salary') || text.includes('remuner')) return 'paid signal';
  return 'a confirmar';
}

function inferApplicationLanguage(job) {
  const text = normalizeText(`${job.location || ''} ${job.link || ''}`);
  return text.includes('portugal') || text.includes('lisboa') || text.includes('lisbon') || text.includes('.pt') ? 'pt' : 'en';
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || '').match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function repairMojibake(value) {
  const text = String(value || '');
  if (!/[ÃÂ]|â[€\x80-\x9f]/.test(text)) return text;
  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf8');
    return mojibakeScore(repaired) < mojibakeScore(text) ? repaired : text;
  } catch {
    return text;
  }
}

function mojibakeScore(value) {
  return (String(value || '').match(/[ÃÂ]|â[€\x80-\x9f]|�/g) || []).length;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    cloud: false,
    fromHtml: '',
    outputDir: '',
    rank: false,
    dashboard: false,
    minScore: undefined,
    writeLimit: undefined,
    maxJobs: undefined,
    task: '',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--cloud') options.cloud = true;
    else if (arg === '--from-html') options.fromHtml = argv[++index] || '';
    else if (arg === '--out') options.outputDir = argv[++index] || '';
    else if (arg === '--write-snapshot') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--rank') options.rank = true;
    else if (arg === '--dashboard') {
      options.rank = true;
      options.dashboard = true;
      options.dryRun = false;
    }
    else if (arg === '--min-score') options.minScore = Number(argv[++index]);
    else if (arg === '--write-limit') options.writeLimit = Number(argv[++index]);
    else if (arg === '--max-jobs') options.maxJobs = Number(argv[++index]);
    else if (arg === '--task') options.task = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage: node browser-use-jobs.mjs [options]

Local HTML import:
  node browser-use-jobs.mjs --from-html "../../lisbon-tech-junior-brief.html" --rank

Cloud search:
  set BROWSER_USE_API_KEY in your shell, then:
  node browser-use-jobs.mjs --cloud --rank --write-snapshot

Options:
  --from-html <path>    Import an existing Browser Use HTML report.
  --cloud               Ask Browser Use Cloud to search public job sources.
  --rank                Run official Leagle Job scoring on new candidates.
  --dashboard           Write selected scored candidates to dashboard.
  --write-snapshot      Write output/browser-use/*.json.
  --dry-run             Do not write files. Default.
  --min-score <number>  Minimum official Leagle Job score for dashboard mode.
  --write-limit <n>     Max dashboard writes in dashboard mode.
  --max-jobs <n>        Max jobs requested in cloud mode.
  --task <text>         Custom Browser Use Cloud task.
`);
}

function printResult(result) {
  console.log(`\nBrowser Use ${result.mode} import`);
  console.log(`Source: ${result.source}`);
  console.log(`Found: ${result.found}`);
  console.log(`New candidates: ${result.new_candidates}`);
  console.log(`Skipped known: ${result.skipped_known}`);
  console.log(`Skipped duplicate: ${result.skipped_duplicate}`);
  console.log(`Snapshot: ${result.snapshot_path}`);

  if (result.rank) {
    console.log(`\nOfficial Leagle Job ranking: ${result.rank.scanned} scanned, ${result.rank.selected.length} selected.`);
    for (const item of result.rank.ranked.slice(0, 10)) {
      console.log(`- ${item.evaluation.score}/100 ${item.evaluation.recommendation.toUpperCase()} | ${item.job.company} | ${item.job.title}`);
    }
    if (result.rank.written?.length) {
      console.log('\nWritten to dashboard:');
      for (const item of result.rank.written) {
        console.log(`- #${item.id} ${item.company} | ${item.title} | ${item.score}/100`);
      }
    }
  }
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBrowserUseJobs(parseArgs(process.argv.slice(2)))
    .then(printResult)
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
