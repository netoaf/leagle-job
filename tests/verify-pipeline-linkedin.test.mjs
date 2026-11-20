import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('pipeline verification does not flag distinct LinkedIn job IDs as duplicates', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle verify linkedin identity '));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
    copyFileSync(join(projectRoot, 'verify-pipeline.mjs'), join(root, 'verify-pipeline.mjs'));
    writeFileSync(join(root, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-08-14 | Affinity | Java Developer | 25/100 | Applied | - | - | [channel:linkedin] [linkedin-job-id:111] |',
      '| 2 | 2026-08-14 | Affinity | Java Developer | 30/100 | Applied | - | - | [channel:linkedin] [linkedin-job-id:222] |',
      '',
    ].join('\n'), 'utf8');

    const result = spawnSync(process.execPath, [join(root, 'verify-pipeline.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stdout, /Possible duplicates/);
    assert.match(result.stdout, /Pipeline Health: 0 errors, 0 warnings/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
