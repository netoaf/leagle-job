#!/usr/bin/env node

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const projectRoot = dirname(fileURLToPath(import.meta.url));

const checks = [
  {
    name: 'doctor',
    command: process.execPath,
    args: ['doctor.mjs'],
    cwd: projectRoot,
  },
  {
    name: 'validate config',
    command: process.execPath,
    args: ['job-scoring-service.mjs', '--validate'],
    cwd: projectRoot,
  },
  {
    name: 'unit safety and pipeline foundations',
    command: process.execPath,
    args: [
      '--test',
      'tests/safe-fetch.test.mjs',
      'tests/eightfold-adapter.test.mjs',
      'tests/job-pipeline-foundation.test.mjs',
    ],
    cwd: projectRoot,
  },
  {
    name: 'scoring examples',
    command: process.execPath,
    args: ['job-scoring-service.mjs', '--examples'],
    cwd: projectRoot,
  },
  {
    name: 'pipeline verify',
    command: process.execPath,
    args: ['verify-pipeline.mjs'],
    cwd: projectRoot,
  },
  {
    name: 'application pack dry-run',
    command: process.execPath,
    args: ['application-pack.mjs', '--dry-run', '--top', '1'],
    cwd: projectRoot,
  },
  {
    name: 'draft quality gate',
    command: process.execPath,
    args: ['draft-quality-gate.mjs'],
    cwd: projectRoot,
  },
  {
    name: 'email policy',
    command: process.execPath,
    args: ['email-drafts.mjs', '--check-policy'],
    cwd: projectRoot,
  },
  {
    name: 'email drafts dry-run',
    command: process.execPath,
    args: ['email-drafts.mjs', '--dry-run', '--top', '1'],
    cwd: projectRoot,
  },
  {
    name: 'application actions dry-run',
    command: process.execPath,
    args: ['application-actions.mjs', '--dry-run', '--top', '1'],
    cwd: projectRoot,
  },
  {
    name: 'browser agent safety',
    command: process.execPath,
    args: ['browser-agent.mjs', '--check'],
    cwd: projectRoot,
  },
];

const goExe = join(projectRoot, 'tools', 'go', 'bin', 'go.exe');
const dashboardDir = join(projectRoot, 'dashboard');
const browserUseBrief = join(projectRoot, '..', '..', 'lisbon-tech-junior-brief.html');
const vaultDir = join(projectRoot, '..', '..', 'obsidian_vault');
if (existsSync(browserUseBrief)) {
  checks.push({
    name: 'browser use html import',
    command: process.execPath,
    args: ['browser-use-jobs.mjs', '--dry-run', '--from-html', browserUseBrief],
    cwd: projectRoot,
  });
}

if (existsSync(vaultDir)) {
  checks.push({
    name: 'vault snapshot dry-run',
    command: process.execPath,
    args: ['vault-snapshot.mjs', '--dry-run'],
    cwd: projectRoot,
  });
}

if (existsSync(goExe) && existsSync(dashboardDir)) {
  checks.push({
    name: 'dashboard go tests',
    command: goExe,
    args: ['test', './...'],
    cwd: dashboardDir,
    env: {
      ...process.env,
      GOCACHE: join(dashboardDir, '.gocache'),
    },
  });
}

let failed = 0;
const startedAt = Date.now();

console.log('\nLeagle Job health');
console.log('================\n');

for (const check of checks) {
  const result = runCheck(check);
  if (!result.ok) failed += 1;
}

const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('\n================');
if (failed > 0) {
  console.log(`Health result: FAIL (${failed}/${checks.length} failed, ${duration}s)`);
  process.exit(1);
}

console.log(`Health result: PASS (${checks.length}/${checks.length} checks passed, ${duration}s)`);

function runCheck(check) {
  const label = `[${check.name}]`;
  console.log(`${label} running...`);
  const started = Date.now();
  const result = spawnSync(check.command, check.args, {
    cwd: check.cwd,
    env: check.env || process.env,
    encoding: 'utf-8',
    shell: false,
  });

  const duration = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === 0) {
    console.log(`${label} PASS (${duration}s)`);
    return { ok: true };
  }

  console.log(`${label} FAIL (${duration}s)`);
  if (result.stdout) console.log(trimOutput(result.stdout));
  if (result.stderr) console.error(trimOutput(result.stderr));
  return { ok: false };
}

function trimOutput(value) {
  const lines = String(value || '').trim().split(/\r?\n/);
  const maxLines = 30;
  if (lines.length <= maxLines) return lines.join('\n');
  return [
    ...lines.slice(0, 12),
    `... ${lines.length - maxLines} line(s) omitted ...`,
    ...lines.slice(-18),
  ].join('\n');
}
