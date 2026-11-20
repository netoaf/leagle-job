import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('pipeline verification rejects a ready action for an applied application', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle reconcile '));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
    copyFileSync(join(projectRoot, 'verify-pipeline.mjs'), join(root, 'verify-pipeline.mjs'));
    writeFileSync(join(root, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 52 | 2026-08-22 | Example | Internship | 90/100 | Applied | - | - | [action:applied] |',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'data', 'application-actions.tsv'), [
      'id\tapplication_id\treport_number\tcompany\trole\tchannel\tapply_url\trecipient\tstatus\tblocker\tnext_action\tcreated_at\tupdated_at\tnotes',
      '052\t52\t052\tExample\tInternship\tlinkedin_apply\thttps://example.test/job\ta confirmar\tready_linkedin_prepare\tnone\tprepare\t2026-08-22\t2026-08-22\ttest',
      '',
    ].join('\n'));

    const result = spawnSync(process.execPath, [join(root, 'verify-pipeline.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /#52: Applied application still has ready action/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pipeline verification rejects a scheduled application missing from the email ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle reconcile '));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
    copyFileSync(join(projectRoot, 'verify-pipeline.mjs'), join(root, 'verify-pipeline.mjs'));
    writeFileSync(join(root, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 140 | 2026-08-22 | Example | Internship | 80/100 | Scheduled | ✅ | - | [scheduled:gmail] |',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'data', 'email-drafts.tsv'), 'id\tapplication_id\n');

    const result = spawnSync(process.execPath, [join(root, 'verify-pipeline.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /#140: Scheduled application missing from email ledger/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
