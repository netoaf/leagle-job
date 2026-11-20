import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('merge --verify supports a project path containing spaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle job merge '));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
    copyFileSync(join(projectRoot, 'merge-tracker.mjs'), join(root, 'merge-tracker.mjs'));
    writeFileSync(join(root, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(
      join(root, 'batch', 'tracker-additions', '001-example.tsv'),
      '1\t2026-08-21\tExample\tJunior Developer\tScheduled\t80\t✅\t[001](reports/001.md)\tScheduled test\n',
      'utf8',
    );
    writeFileSync(
      join(root, 'verify-pipeline.mjs'),
      "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('./verified.marker', import.meta.url), 'ok');\n",
      'utf8',
    );

    const result = spawnSync(process.execPath, [join(root, 'merge-tracker.mjs'), '--verify'], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(root, 'verified.marker')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('merge keeps distinct LinkedIn postings with the same company and title', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle job linkedin identity '));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
    copyFileSync(join(projectRoot, 'merge-tracker.mjs'), join(root, 'merge-tracker.mjs'));
    writeFileSync(join(root, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-08-14 | Affinity | Java Developer | 25/100 | Applied | - | [001](reports/001.md) | [channel:linkedin] [linkedin-job-id:111] |',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(
      join(root, 'batch', 'tracker-additions', '002-affinity.tsv'),
      '2\t2026-08-14\tAffinity\tJava Developer\tApplied\t30/100\t-\t[002](reports/002.md)\t[channel:linkedin] [linkedin-job-id:222]\n',
      'utf8',
    );

    const result = spawnSync(process.execPath, [join(root, 'merge-tracker.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    const tracker = existsSync(join(root, 'data', 'applications.md'))
      ? readFileSync(join(root, 'data', 'applications.md'), 'utf8')
      : '';

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(tracker, /\[linkedin-job-id:111\]/);
    assert.match(tracker, /\[linkedin-job-id:222\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
