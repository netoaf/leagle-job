#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadYamlFile } from './lib/config-loader.mjs';
import { normalizeText, normalizeWhitespace } from './lib/job-normalizer.mjs';
import {
  assertSafeNavigationUrl,
  installPlaywrightNetworkGuard,
} from './lib/network/playwright-guard.mjs';
import { safeFetch } from './lib/network/safe-fetch.mjs';
import { classifySourceHealth, detectSourceAdapter } from './lib/source-adapters.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'LeagleJob/1.4 (based on Career-Ops; local source-health audit; respectful low-volume scan)';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const CANONICAL_SOURCE_HEALTH_PATH = join('data', 'source-health.tsv');
const PREVIEW_SOURCE_HEALTH_PATH = join('reports', 'source-health-preview.tsv');
const PORTUGAL_PRIORITY_COMPANIES = new Set([
  'outsystems',
  'feedzai',
  'talkdesk',
  'blip',
  'critical techworks',
  'unbabel',
  'sword health',
  'mindera',
  'xpand it',
  'imaginary cloud',
  'defined.ai',
  'untile',
  'rows',
  'noesis',
  'devoteam',
  'ntt data portugal',
  'farfetch',
  'accenture portugal',
  'capgemini portugal',
  'inetum portugal',
  'aubay portugal',
  'sap',
  'bosch portugal',
  'siemens portugal',
  'zalando',
  'n26',
]);

export async function runPortalAudit(options = {}) {
  const root = options.projectRoot || projectRoot;
  const portals = loadYamlFile(join(root, 'portals.yml'));
  const allCompanies = (portals.tracked_companies || []).filter((company) => company && company.name && company.careers_url);
  const companies = selectCompanies(allCompanies, options);
  const checkedAt = new Date().toISOString();
  const concurrency = normalizedConcurrency(options.concurrency);
  const rows = await auditCompanies(companies, checkedAt, { ...options, concurrency });

  const partial = isPartialAudit(options);
  const result = {
    checked_at: checkedAt,
    total_configured_sources: allCompanies.length,
    total_sources: rows.length,
    concurrency,
    partial,
    summary: summarizeRows(rows),
    rows,
  };

  if (options.write !== false) {
    const outputPath = sourceHealthOutputPath(options, partial);
    result.output_path = writeSourceHealth(root, rows, outputPath);
    result.output_kind = outputPath === CANONICAL_SOURCE_HEALTH_PATH ? 'canonical' : 'preview';
  }

  return result;
}

async function auditCompanies(companies, checkedAt, options) {
  const rows = new Array(companies.length);
  let cursor = 0;
  const workerCount = Math.min(options.concurrency, companies.length);

  async function worker() {
    while (cursor < companies.length) {
      const index = cursor;
      cursor += 1;
      rows[index] = await auditCompany(companies[index], checkedAt, options);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return rows;
}

function selectCompanies(companies, options) {
  const sourceFilter = normalizeText(options.source || '');
  const groupFilter = normalizeText(options.group || '');
  const includeDisabled = Boolean(options.includeDisabled);
  const limit = Number(options.limit ?? companies.length);

  return companies
    .filter((company) => company && company.name && company.careers_url)
    .filter((company) => includeDisabled || company.enabled !== false)
    .filter((company) => !sourceFilter || normalizeText(company.name).includes(sourceFilter))
    .filter((company) => !groupFilter || sourceGroupFor(company).includes(groupFilter))
    .slice(0, Number.isFinite(limit) && limit >= 0 ? limit : companies.length);
}

async function auditCompany(company, checkedAt, options) {
  const url = company.careers_url;
  const enabled = company.enabled !== false;
  const base = {
    company: company.name,
    group: sourceGroupFor(company),
    url,
    checked_url: company.api || url,
    enabled,
    status: 'unknown',
    http_code: '',
    final_url: '',
    detected_adapter: '',
    adapter_status: '',
    error: '',
    last_checked: checkedAt,
    next_action: '',
  };

  if (!enabled && !options.includeDisabled) return base;

  try {
    const response = await fetchSource(base.checked_url, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const detection = detectSourceAdapter({
      url,
      finalUrl: response.finalUrl,
      html: response.text,
      api: company.api || '',
      adapter: company.adapter || '',
    });
    const health = classifySourceHealth({
      enabled,
      httpCode: response.status,
      adapter: detection.adapter,
      scanner: detection.scanner,
    });

    if (['blocked', 'rate_limited'].includes(health.status) && shouldUseBrowserAudit(company)) {
      const rendered = await fetchRenderedSource(url, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) + 10000);
      return {
        ...base,
        status: 'healthy',
        http_code: String(response.status),
        final_url: rendered.finalUrl,
        detected_adapter: 'browser',
        adapter_status: 'existing',
        next_action: 'scan_with_browser_fallback',
      };
    }

    return {
      ...base,
      status: health.status,
      http_code: String(response.status),
      final_url: response.finalUrl,
      detected_adapter: detection.adapter,
      adapter_status: detection.scanner,
      next_action: health.next_action,
    };
  } catch (error) {
    const detection = detectSourceAdapter({ url, api: company.api || '', adapter: company.adapter || '' });

    if (shouldUseBrowserAudit(company)) {
      try {
        const rendered = await fetchRenderedSource(url, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) + 10000);
        return {
          ...base,
          status: 'healthy',
          final_url: rendered.finalUrl,
          detected_adapter: 'browser',
          adapter_status: 'existing',
          next_action: 'scan_with_browser_fallback',
        };
      } catch (browserError) {
        // Fall through to the normal fetch failure classification.
      }
    }

    const health = classifySourceHealth({
      enabled,
      error: error.message,
      adapter: detection.adapter,
      scanner: detection.scanner,
    });

    return {
      ...base,
      status: health.status,
      detected_adapter: detection.adapter,
      adapter_status: detection.scanner,
      error: normalizeWhitespace(error.message),
      next_action: health.next_action,
    };
  }
}

function shouldUseBrowserAudit(company) {
  const adapter = normalizeText(company.adapter || '').replace(/[^a-z0-9]+/g, '_');
  return ['browser', 'playwright', 'browser_fallback'].includes(adapter);
}

async function fetchSource(url, timeoutMs) {
  const response = await safeFetch(url, {
    timeoutMs,
    redirect: 'follow',
    maxResponseBytes: 8 * 1024 * 1024,
    headers: {
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8',
      'user-agent': USER_AGENT,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  return {
    status: response.status,
    ok: response.ok,
    finalUrl: response.url,
    contentType,
    text,
  };
}

async function fetchRenderedSource(url, timeoutMs) {
  await assertSafeNavigationUrl(url);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'pt-PT',
    serviceWorkers: 'block',
  });
  await installPlaywrightNetworkGuard(context, {
    blockedResourceTypes: ['image', 'media', 'font'],
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(2500);
    return {
      finalUrl: page.url(),
      text: await page.content(),
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

function writeSourceHealth(root, rows, outputPath) {
  const file = outputPath
    ? resolve(root, outputPath)
    : join(root, 'data', 'source-health.tsv');

  mkdirSync(dirname(file), { recursive: true });
  const header = [
    'company',
    'group',
    'url',
    'checked_url',
    'enabled',
    'status',
    'http_code',
    'final_url',
    'detected_adapter',
    'adapter_status',
    'error',
    'last_checked',
    'next_action',
  ].join('\t');
  const body = rows.map((row) => [
    row.company,
    row.group,
    row.url,
    row.checked_url,
    row.enabled ? 'true' : 'false',
    row.status,
    row.http_code,
    row.final_url,
    row.detected_adapter,
    row.adapter_status,
    row.error,
    row.last_checked,
    row.next_action,
  ].map(tsvCell).join('\t'));

  writeFileSync(file, `${header}\n${body.join('\n')}\n`, 'utf-8');
  return file;
}

function summarizeRows(rows) {
  const summary = {};
  for (const row of rows) {
    summary[row.status] = (summary[row.status] || 0) + 1;
  }
  return summary;
}

function printAuditResult(result) {
  console.log(`\nPortal audit complete: ${result.total_sources}/${result.total_configured_sources} source(s) checked.`);
  console.log(`Concurrency: ${result.concurrency}`);
  if (result.partial && result.output_path && result.output_kind !== 'canonical') {
    console.log('Partial audit detected: canonical data/source-health.tsv was not overwritten.');
  }
  if (result.output_path) console.log(`Source health: ${relativePath(result.output_path)}`);

  console.log('\nSummary:');
  for (const [status, count] of Object.entries(result.summary).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${status}: ${count}`);
  }

  const important = result.rows
    .filter((row) => row.status !== 'healthy')
    .slice(0, 25);

  if (important.length > 0) {
    console.log('\nNeeds attention:');
    for (const row of important) {
      const code = row.http_code ? ` HTTP ${row.http_code}` : '';
      const error = row.error ? ` | ${row.error}` : '';
      console.log(`- ${row.company}: ${row.status}${code} | ${row.detected_adapter} | ${row.next_action}${error}`);
    }
    if (result.rows.filter((row) => row.status !== 'healthy').length > important.length) {
      console.log(`- ... ${result.rows.filter((row) => row.status !== 'healthy').length - important.length} more source(s)`);
    }
  }
}

function parseArgs(argv) {
  const options = {
    includeDisabled: false,
    limit: undefined,
    source: '',
    group: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    concurrency: DEFAULT_CONCURRENCY,
    write: true,
    replace: false,
    outputPath: '',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--include-disabled') options.includeDisabled = true;
    else if (arg === '--limit') options.limit = Number(argv[++index]);
    else if (arg === '--source') options.source = argv[++index] || '';
    else if (arg === '--group') options.group = argv[++index] || '';
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index] || options.timeoutMs);
    else if (arg === '--concurrency') options.concurrency = Number(argv[++index] || options.concurrency);
    else if (arg === '--no-write') options.write = false;
    else if (arg === '--dry-run') options.write = false;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--out') options.outputPath = argv[++index] || '';
  }

  return options;
}

function printHelp() {
  console.log(`
Usage: node portal-audit.mjs [options]

Options:
  --source <name>         Audit sources whose name contains this text.
  --group <group>         Audit inferred group, e.g. portugal_priority.
  --limit <number>        Audit only the first N selected sources.
  --include-disabled      Include disabled sources in the audit.
  --timeout <ms>          Per-source fetch timeout. Default: ${DEFAULT_TIMEOUT_MS}.
  --concurrency <number>  Parallel checks, clamped 1-${MAX_CONCURRENCY}. Default: ${DEFAULT_CONCURRENCY}.
  --dry-run, --no-write   Print results without writing TSV files.
  --out <path>            Write to a custom relative/absolute path.
  --replace               Allow a filtered/limited audit to overwrite data/source-health.tsv.
  --help                  Show this help.

Safe default:
  Full audits write ${CANONICAL_SOURCE_HEALTH_PATH}.
  Filtered or limited audits write ${PREVIEW_SOURCE_HEALTH_PATH}, unless --out or --replace is used.
`);
}

function relativePath(file) {
  return file.replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

function sourceGroupFor(company) {
  const name = normalizeText(company.name || '');
  const text = normalizeText(`${company.name || ''} ${company.careers_url || ''} ${company.scan_query || ''} ${company.notes || ''}`);

  if (PORTUGAL_PRIORITY_COMPANIES.has(name)) return 'portugal_priority';
  if (hasAny(text, ['portugal', 'lisboa', 'lisbon', 'porto', 'coimbra', 'aveiro', 'braga', '.pt/'])) return 'portugal_general';
  if (hasAny(text, ['remote eu', 'remote europe', 'europe', 'emea', 'germany', 'berlin', 'dach', 'paris', 'london', 'zurich', 'amsterdam', 'madrid', 'barcelona'])) return 'remote_europe';
  return 'global';
}

function isPartialAudit(options) {
  return Boolean(
    options.source
    || options.group
    || options.limit !== undefined
  );
}

function sourceHealthOutputPath(options, partial) {
  if (options.outputPath) return options.outputPath;
  if (partial && !options.replace) return PREVIEW_SOURCE_HEALTH_PATH;
  return CANONICAL_SOURCE_HEALTH_PATH;
}

function normalizedConcurrency(value) {
  const parsed = Number(value || DEFAULT_CONCURRENCY);
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(parsed)));
}

function hasAny(text, needles) {
  const source = normalizeText(text);
  return needles.some((needle) => source.includes(normalizeText(needle)));
}

function tsvCell(value) {
  return normalizeWhitespace(value).replace(/\t/g, ' ');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  runPortalAudit(options)
    .then(printAuditResult)
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
