#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export function auditSourceCoverage(options = {}) {
  const root = options.projectRoot || projectRoot;
  const days = Number(options.days || 7);
  const now = options.now ? new Date(options.now) : new Date();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  const history = readTsv(join(root, 'data', 'scan-history.tsv'));
  const recent = history.filter((row) => {
    const parsed = new Date(`${row.first_seen || ''}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed >= cutoff && parsed <= now;
  });

  const lanes = [
    { id: 'linkedin', label: 'LinkedIn', domains: ['linkedin.com'], minimum: 5 },
    { id: 'indeed', label: 'Indeed', domains: ['indeed.com'], minimum: 3 },
    { id: 'iefp', label: 'IEFP Online', domains: ['iefponline.iefp.pt'], minimum: 3 },
    { id: 'itjobs', label: 'ITJobs', domains: ['itjobs.pt'], minimum: 3 },
    { id: 'net_empregos', label: 'Net-Empregos', domains: ['net-empregos.com'], minimum: 3 },
  ].map((lane) => {
    const laneRows = uniqueByUrl(recent.filter((row) => lane.domains.some((domain) => hostname(row.url).includes(domain))));
    const capturedCount = laneRows.length;
    const qualifiedCount = laneRows.filter((row) => isQualifiedCapture(row.status)).length;
    return {
      ...lane,
      count: capturedCount,
      captured_count: capturedCount,
      qualified_count: qualifiedCount,
      status: qualifiedCount >= lane.minimum ? 'covered' : 'undercovered',
    };
  });

  const sourceHealth = readTsv(join(root, 'data', 'source-health.tsv'));
  const latestHealth = sourceHealth
    .map((row) => new Date(row.last_checked || ''))
    .filter((date) => !Number.isNaN(date.valueOf()))
    .sort((a, b) => b - a)[0];
  const healthAgeDays = latestHealth
    ? Math.floor((now - latestHealth) / 86400000)
    : null;

  const browserUse = readText(join(root, 'config', 'browser-use.yml'));
  const browserUseEnabled = /^enabled:\s*true\s*$/m.test(browserUse);
  const localExtensionPresent = existsSync(join(root, 'extension', 'manifest.json'));
  const warnings = [];
  for (const lane of lanes.filter((item) => item.status !== 'covered')) {
    warnings.push(`${lane.label} has ${lane.captured_count} captured and only ${lane.qualified_count} qualified URL(s) in the last ${days} days; target is ${lane.minimum} qualified.`);
  }
  if (healthAgeDays === null || healthAgeDays > 7) warnings.push(`Source-health evidence is stale (${healthAgeDays ?? 'unknown'} days old).`);
  if (!browserUseEnabled) warnings.push('Optional Browser Use radar is disabled.');
  if (!localExtensionPresent) warnings.push('No Leagle Job-native one-click capture extension is installed in this project.');

  return {
    audited_at: now.toISOString(),
    days,
    history_total: history.length,
    recent_total: recent.length,
    lanes,
    source_health: {
      total: sourceHealth.length,
      latest_checked: latestHealth?.toISOString() || '',
      age_days: healthAgeDays,
    },
    browser_use_enabled: browserUseEnabled,
    leagle_extension_present: localExtensionPresent,
    status: warnings.length ? 'degraded' : 'covered',
    warnings,
  };
}

function readTsv(file) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => Object.fromEntries(line.split('\t').map((value, index) => [header[index], value])));
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function hostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function uniqueByUrl(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row.url || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isQualifiedCapture(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return false;
  return !/^(skipped|discard|closed|inactive|expired|rejected|failed|error)/.test(value);
}

function parseArgs(argv) {
  const options = { days: 7, json: false, strict: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--days') options.days = Number(argv[++index] || 7);
    else if (argv[index] === '--json') options.json = true;
    else if (argv[index] === '--strict') options.strict = true;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = auditSourceCoverage(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Source coverage: ${result.status.toUpperCase()} (${result.recent_total} recent URLs / ${result.history_total} total)`);
    for (const lane of result.lanes) console.log(`- ${lane.label}: ${lane.captured_count} captured / ${lane.qualified_count} qualified (${lane.status})`);
    for (const warning of result.warnings) console.log(`WARNING: ${warning}`);
  }
  if (options.strict && result.status !== 'covered') process.exitCode = 1;
}
