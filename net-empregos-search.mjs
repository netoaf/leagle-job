#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runScanAndRank } from './scan-and-rank.mjs';
import { normalizeText, normalizeWhitespace, stripHtml, todayISO } from './lib/job-normalizer.mjs';
import { safeFetch } from './lib/network/safe-fetch.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://www.net-empregos.com/';
const USER_AGENT = 'LeagleJob/1.4 (based on Career-Ops; net-empregos technical audit; respectful low-volume)';

const DEFAULT_QUERIES = [
  'programador junior',
  'estagio informatica',
  'junior developer',
  'qa junior',
  'tester junior',
  'suporte tecnico informatica',
  'programador junior remoto',
  'estagio programacao',
  'recem licenciado informatica',
  'automacao ia',
  'low-code',
  'power platform',
  'python junior',
  'react junior',
  'c# junior',
  '.net junior',
  'full stack junior',
  'qa informatica',
  'estagio software',
  'estagio programador',
  'developer junior remoto',
  'software engineer junior',
  'tecnico informatica junior',
  'helpdesk informatica junior',
  'data junior',
  'sql junior',
  'java junior',
  'javascript junior',
  'backend junior',
  'frontend junior',
  'trainee informatica',
  'iefp informatica',
  'transformacao digital estagio',
  'microsoft copilot junior',
  'dynamics junior',
  'salesforce junior',
];

const TECH_TERMS = [
  'programador',
  'developer',
  'software',
  'engineer',
  'engenheiro informatico',
  'informatica',
  'qa',
  'tester',
  'quality',
  'automation',
  'automacao',
  'python',
  'java',
  'javascript',
  'typescript',
  'react',
  'angular',
  'node',
  'c#',
  '.net',
  'sql',
  'dados',
  'data',
  'api',
  'cloud',
  'power platform',
  'low-code',
  'no-code',
  'copilot',
  'dynamics',
  'salesforce',
  'transformacao digital',
  'it',
  'ti',
];

const EARLY_TERMS = [
  'junior',
  'júnior',
  'estagio',
  'estágio',
  'estagiario',
  'estagiário',
  'trainee',
  'iefp',
  'recem',
  'recém',
  'entry',
];

const NEGATIVE_TERMS = [
  'advogado',
  'contabilidade',
  'contabilista',
  'financeiro',
  'recursos humanos',
  'marketing',
  'comercial',
  'imobiliario',
  'imobiliário',
  'civil',
  'mecanico',
  'mecânico',
  'eletrotecnico',
  'eletrotécnico',
  'enfermeiro',
  'chef',
  'cozinha',
  'motorista',
  'arquiteto paisagista',
  'design grafico',
  'designer grafico',
  'sinistros',
];

export async function runNetEmpregosSearch(options = {}) {
  const root = options.projectRoot || projectRoot;
  const queries = options.queries?.length ? options.queries : DEFAULT_QUERIES;
  const maxCandidates = Number(options.maxCandidates || 240);
  const maxPerQuery = Number(options.maxPerQuery || 25);
  const candidates = [];
  const skipped = [];
  const errors = [];
  const sourceStats = [];
  const seen = new Set();

  for (const query of queries) {
    if (candidates.length >= maxCandidates) break;
    const before = candidates.length;
    try {
      const jobs = await fetchQueryJobs(query, { maxPerQuery, timeoutMs: Number(options.timeoutMs || 18000) });
      for (const job of jobs) {
        if (candidates.length >= maxCandidates) break;
        if (seen.has(job.link)) continue;
        seen.add(job.link);
        if (!isRelevant(job)) {
          skipped.push({ ...job, reason: 'net_empregos_filter' });
          continue;
        }
        const detailed = options.noDetails ? job : await fetchJobDetails(job);
        candidates.push(detailed);
      }
    } catch (error) {
      errors.push({ source: `Net-Empregos ${query}`, error: error.message });
    }
    sourceStats.push({
      source: `Net-Empregos ${query}`,
      type: 'net_empregos_html',
      discovered: Math.max(0, candidates.length - before),
      accepted: Math.max(0, candidates.length - before),
      skipped: skipped.length,
    });
  }

  const snapshot = {
    scanned_at: new Date().toISOString(),
    scan_mode: 'net-empregos-search',
    candidates,
    skipped,
    errors,
    source_stats: sourceStats,
  };

  const snapshotPath = writeSnapshot(root, snapshot, options);
  const rank = await runScanAndRank({
    projectRoot: root,
    dryRun: Boolean(options.dryRun),
    snapshot,
    writeLimit: Number(options.writeLimit ?? 0),
    minScore: options.minScore,
  });

  return {
    dry_run: Boolean(options.dryRun),
    candidates_found: candidates.length,
    skipped_found: skipped.length,
    snapshot_path: snapshotPath,
    errors,
    rank,
  };
}

async function fetchQueryJobs(query, options) {
  const url = `${BASE_URL}pesquisa-empregos.asp?chaves=${encodeURIComponent(query).replace(/%20/g, '+')}`;
  const html = await fetchText(url, options.timeoutMs);
  return extractJobBlocks(html).slice(0, options.maxPerQuery).map((block) => parseListingBlock(block)).filter((job) => job.link);
}

async function fetchJobDetails(job) {
  try {
    const html = await fetchText(job.link, 18000);
    const json = parseJsonLd(html) || {};
    const fallback = splitTitleCompany(json.title || titleFromHtml(html) || job.title);
    const sourceText = json.description || html;
    const company = json.hiringOrganization?.name || fallback.company || job.company;
    const title = fallback.title || json.title || job.title;
    const location = json.jobLocation?.address?.addressLocality || json.jobLocation?.address?.addressRegion || job.location || 'Portugal';
    return {
      ...job,
      title: ascii(title),
      company: ascii(company),
      location: ascii(`${location}, Portugal`),
      work_mode: inferWorkMode(sourceText),
      description: ascii(sourceText).slice(0, 8000),
      external_id: externalId(job.link),
      date_posted: String(json.datePosted || '').slice(0, 10),
      valid_through: String(json.validThrough || '').slice(0, 10),
      employment_type: ascii(json.employmentType || ''),
    };
  } catch {
    return job;
  }
}

function parseListingBlock(block) {
  const href = block.match(/href="([^"]+)"/i)?.[1] || '';
  const link = href ? new URL(href, BASE_URL).toString() : '';
  const title = ascii(block.match(/<h2[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
  const company = ascii(block.match(/flaticon-work[\s\S]*?<\/i>\s*([\s\S]*?)<\/li>/i)?.[1] || 'a confirmar');
  const location = ascii(block.match(/flaticon-pin[\s\S]*?<\/i>\s*([\s\S]*?)<\/li>/i)?.[1] || 'Portugal');
  const category = ascii(block.match(/fa-tags[\s\S]*?<\/i>\s*([\s\S]*?)<\/li>/i)?.[1] || '');

  return {
    title,
    company,
    location,
    work_mode: inferWorkMode(`${title} ${location} ${category}`),
    link,
    description: ascii(`${title} ${company} ${location} ${category}`),
    source: 'Net-Empregos search',
    external_id: externalId(link),
  };
}

function isRelevant(job) {
  const title = normalizeText(job.title || '');
  const text = normalizeText(`${job.title || ''} ${job.company || ''} ${job.location || ''} ${job.description || ''}`);
  if (!job.title || !job.link) return false;
  if (NEGATIVE_TERMS.some((term) => hasTerm(title, term))) return false;
  const hasTech = TECH_TERMS.some((term) => hasTerm(title, term) || hasTerm(text, term));
  const hasEarly = EARLY_TERMS.some((term) => hasTerm(title, term) || hasTerm(text, term));
  return hasTech && hasEarly;
}

function extractJobBlocks(html) {
  return [...html.matchAll(/<div class="job-item media">([\s\S]*?)(?=<div class="job-item media">|<div class="pagination|<footer|$)/gi)]
    .map((match) => match[1]);
}

function parseJsonLd(html) {
  const block = html.match(/<script\s+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!block) return null;
  try {
    const json = JSON.parse(block.trim());
    return json?.['@type'] === 'JobPosting' ? json : null;
  } catch {
    return null;
  }
}

function splitTitleCompany(value) {
  const cleaned = clean(value).replace(/\s+-\s+Ref\.\d+.*$/i, '');
  const parts = cleaned.split(/\s+-\s+/);
  if (parts.length >= 2) return { title: parts.slice(0, -1).join(' - '), company: parts.at(-1) };
  return { title: cleaned, company: 'a confirmar' };
}

async function fetchText(url, timeoutMs) {
  const response = await safeFetch(url, {
    timeoutMs,
    requireHttps: true,
    maxResponseBytes: 8 * 1024 * 1024,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,*/*',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return new TextDecoder('windows-1252').decode(await response.arrayBuffer());
}

function inferWorkMode(value) {
  const text = normalizeText(value);
  if (text.includes('remoto') || text.includes('remote')) return 'Remote';
  if (text.includes('hibrido') || text.includes('hybrid')) return 'Hybrid';
  if (text.includes('presencial')) return 'Onsite';
  return 'a confirmar';
}

function hasTerm(text, term) {
  const normalizedTerm = normalizeText(term).replace(/[^a-z0-9+#.]+/g, ' ').trim();
  if (!normalizedTerm) return false;
  const pattern = normalizedTerm
    .split(' ')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^a-z0-9+#.]+');
  return new RegExp(`(^|[^a-z0-9+#.])${pattern}([^a-z0-9+#.]|$)`).test(text);
}

function writeSnapshot(root, snapshot, options) {
  const outputDir = resolve(root, options.outputDir || join('output', 'net-empregos-search'));
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, `net-empregos-search-${todayISO()}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
  return path;
}

function externalId(link) {
  const id = String(link || '').match(/net-empregos\.com\/(\d+)/)?.[1];
  return id ? `netempregos:${id}` : '';
}

function titleFromHtml(html) {
  return html.match(/<title>(.*?)<\/title>/i)?.[1] || '';
}

function clean(value) {
  return normalizeWhitespace(stripHtml(String(value || '')));
}

function ascii(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^\x00-\x7F]/g, '');
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    writeLimit: 0,
    maxCandidates: 240,
    maxPerQuery: 25,
    minScore: undefined,
    outputDir: '',
    queries: [],
    noDetails: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--write') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--write-limit') options.writeLimit = Number(argv[++index] ?? options.writeLimit);
    else if (arg === '--max-candidates') options.maxCandidates = Number(argv[++index] || options.maxCandidates);
    else if (arg === '--max-per-query') options.maxPerQuery = Number(argv[++index] || options.maxPerQuery);
    else if (arg === '--min-score') options.minScore = Number(argv[++index]);
    else if (arg === '--out') options.outputDir = argv[++index] || '';
    else if (arg === '--query') options.queries.push(argv[++index] || '');
    else if (arg === '--no-details') options.noDetails = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  options.queries = options.queries.filter(Boolean);
  return options;
}

function printResult(result) {
  console.log('\nNet-Empregos search');
  console.log('===================');
  console.log(`Candidates found: ${result.candidates_found}`);
  console.log(`Skipped by prefilter: ${result.skipped_found}`);
  console.log(`Snapshot: ${relativePath(result.snapshot_path)}`);
  console.log(`Errors: ${result.errors.length}`);
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
  node net-empregos-search.mjs --dry-run
  node net-empregos-search.mjs --write --write-limit 0

Options:
  --dry-run              Search and score without writing. Default.
  --write                Persist scan history/job index through official scan-and-rank.
  --write-limit <n>      Maximum dashboard writes. Default: 0.
  --max-candidates <n>   Maximum candidates to score. Default: 240.
  --max-per-query <n>    Maximum listings per query. Default: 25.
  --query <text>         Add a custom query. Can be repeated.
  --no-details           Skip detail page fetches.
  --min-score <n>        Override official write threshold.
  --out <path>           Snapshot output directory.
`);
}

function relativePath(file) {
  return String(file || '').replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  runNetEmpregosSearch(options)
    .then(printResult)
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
