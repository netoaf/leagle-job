#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { todayISO } from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const ATTENTION_STATUSES = new Set(['dead_url', 'blocked', 'fetch_failed', 'needs_adapter', 'rate_limited', 'server_error']);

export function buildSourceHealthCleanup(options = {}) {
  const root = options.projectRoot || projectRoot;
  const rows = loadSourceHealth(root);
  const attention = rows.filter((row) => ATTENTION_STATUSES.has(row.status));
  const markdown = renderCleanup(attention, rows);
  const output = resolve(root, options.output || join('reports', 'source-health-cleanup.md'));

  if (!options.dryRun) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, markdown, 'utf-8');
  }

  return {
    dry_run: Boolean(options.dryRun),
    total: rows.length,
    attention,
    output,
  };
}

function loadSourceHealth(root) {
  const file = join(root, 'data', 'source-health.tsv');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const header = lines.shift()?.split('\t') || [];
  return lines.map((line) => {
    const fields = line.split('\t');
    const row = {};
    header.forEach((key, index) => {
      row[key] = fields[index] || '';
    });
    return row;
  });
}

function renderCleanup(attention, rows) {
  const counts = countBy(rows, 'status');
  const lines = [
    '# Source Health Cleanup Plan',
    '',
    `Generated: ${todayISO()}`,
    '',
    'This is a safe cleanup plan. It does not edit `portals.yml` automatically.',
    '',
    'Recommended workflow:',
    '',
    '- Fix high-value dead URLs first.',
    '- For blocked sources, prefer browser/manual watch before disabling.',
    '- For fetch failures, retry later before changing config.',
    '- For needs_adapter, add or improve a dedicated adapter.',
    '',
    '## Summary',
    '',
    ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([status, count]) => `- ${status}: ${count}`),
    '',
    '## Sources Needing Attention',
    '',
  ];

  if (attention.length === 0) {
    lines.push('No source-health issues found in `data/source-health.tsv`.');
    return lines.join('\n');
  }

  for (const row of attention) {
    lines.push(`### ${row.company || 'a confirmar'}`);
    lines.push('');
    lines.push(`- Group: ${row.group || 'a confirmar'}`);
    lines.push(`- Status: ${row.status || 'a confirmar'}`);
    lines.push(`- HTTP: ${row.http_code || 'a confirmar'}`);
    lines.push(`- Adapter: ${row.detected_adapter || 'a confirmar'} (${row.adapter_status || 'a confirmar'})`);
    lines.push(`- URL: ${row.url || 'a confirmar'}`);
    lines.push(`- Final URL: ${row.final_url || 'a confirmar'}`);
    lines.push(`- Error: ${row.error || 'none'}`);
    lines.push(`- Recommended next action: ${row.next_action || 'a confirmar'}`);
    lines.push('');
  }

  return lines.join('\n');
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key] || 'unknown';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function parseArgs(argv) {
  const options = { dryRun: false, output: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--out') options.output = argv[++index] || '';
  }
  return options;
}

function printResult(result) {
  console.log(`Source health cleanup: ${result.attention.length}/${result.total} sources need attention.`);
  if (result.dry_run) console.log('Dry-run: no cleanup report was written.');
  else console.log(`Output: ${String(result.output).replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  printResult(buildSourceHealthCleanup(parseArgs(process.argv.slice(2))));
}
