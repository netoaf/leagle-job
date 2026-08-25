#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSourceReliability,
  readSourceRunLedger,
} from './lib/source-run-memory.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export function getSourceReliabilityStatus(options = {}) {
  const root = options.projectRoot || projectRoot;
  const file = options.filePath || join(root, 'data', 'source-runs.tsv');
  if (!existsSync(file)) {
    return {
      status: 'no_data',
      exit_code: 0,
      records: 0,
      sources: [],
      alerts: [],
      warnings: [],
    };
  }

  const ledger = readSourceRunLedger(file);
  if (!ledger.compatible) {
    return {
      status: 'invalid',
      exit_code: 1,
      records: 0,
      sources: [],
      alerts: [],
      warnings: ledger.warnings,
    };
  }

  const reliability = computeSourceReliability(ledger.records, {
    threshold: options.threshold,
  });
  return {
    status: reliability.alerts.length > 0
      ? 'alerts'
      : ledger.records.length === 0
        ? 'no_data'
        : ledger.warnings.length > 0
          ? 'warning'
          : 'ok',
    exit_code: 0,
    records: ledger.records.length,
    threshold: reliability.threshold,
    sources: reliability.sources,
    alerts: reliability.alerts,
    warnings: ledger.warnings,
  };
}

export function formatSourceReliabilitySummary(result) {
  if (result.status === 'no_data') {
    return 'Source reliability: no source-run data yet; the next real scan will create it.';
  }
  if (result.status === 'invalid') {
    return `Source reliability: INVALID - ${result.warnings[0] || 'incompatible source-run ledger.'}`;
  }

  const lines = [
    `Source reliability: ${result.status.toUpperCase()} (${result.records} records, ${result.sources.length} comparable source keys, ${result.alerts.length} active alerts)`,
  ];
  for (const alert of result.alerts.slice(0, 25)) {
    if (alert.kind === 'source_failure') {
      lines.push(`- HIGH: ${alert.source} failed in ${alert.streak} consecutive ${alert.profile}/${alert.mode} runs.`);
    } else {
      lines.push(`- MEDIUM: ${alert.source} returned zero matching jobs in ${alert.streak} consecutive ${alert.profile}/${alert.mode} runs; it may simply have no current openings.`);
    }
  }
  for (const warning of result.warnings.slice(0, 10)) {
    lines.push(`- LEDGER WARNING: ${warning}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = { json: false, threshold: undefined, filePath: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--threshold') options.threshold = Number(argv[++index]);
    else if (arg === '--file') options.filePath = resolve(argv[++index] || '');
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

const USAGE = `Usage:
  node source-reliability.mjs
  node source-reliability.mjs --json
  node source-reliability.mjs --threshold 3

Reads local data/source-runs.tsv. Active alerts are informational and exit 0;
only an incompatible ledger schema exits 1.`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
    } else {
      const result = getSourceReliabilityStatus(options);
      console.log(options.json ? JSON.stringify(result, null, 2) : formatSourceReliabilitySummary(result));
      process.exitCode = result.exit_code;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
