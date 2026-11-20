import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from '../lib/atomic-file.mjs';
import { classifyAuditEnvironment, runPortalAudit } from '../portal-audit.mjs';

test('atomic replacement updates an existing file without leaving a temporary file', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-atomic-replace-'));
  const target = join(root, 'source-health.tsv');
  writeFileSync(target, 'previous canonical evidence\n', 'utf8');

  try {
    writeFileAtomic(target, 'fresh verified evidence\n');

    assert.equal(readFileSync(target, 'utf8'), 'fresh verified evidence\n');
    assert.deepEqual(readdirSync(root), ['source-health.tsv']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('atomic replacement failure preserves the previous canonical file and removes its temporary file', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-atomic-write-'));
  const target = join(root, 'source-health.tsv');
  writeFileSync(target, 'previous canonical evidence\n', 'utf8');

  try {
    assert.throws(
      () => writeFileAtomic(target, 'new incomplete evidence\n', {
        renameFile() {
          const error = new Error('simulated replacement failure');
          error.code = 'EACCES';
          throw error;
        },
      }),
      /simulated replacement failure/,
    );

    assert.equal(readFileSync(target, 'utf8'), 'previous canonical evidence\n');
    assert.deepEqual(readdirSync(root), ['source-health.tsv']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('184 network permission failures are classified as an environment failure', () => {
  const rows = Array.from({ length: 184 }, (_, index) => ({
    company: `Source ${index + 1}`,
    status: 'fetch_failed',
    http_code: '',
    error: `connect EACCES 192.0.2.${(index % 200) + 1}:443`,
  }));

  assert.deepEqual(classifyAuditEnvironment(rows), {
    status: 'environment_failure',
    network_failure_ratio: 1,
    reason: '184/184 checks failed with environment-level network errors (100.0%)',
  });
});

test('environment classification uses the 20-check and 80% boundaries without treating HTTP responses as network failures', () => {
  const networkFailure = {
    status: 'fetch_failed',
    http_code: '',
    error: 'getaddrinfo ENOTFOUND jobs.example.test',
  };
  const httpFailure = {
    status: 'blocked',
    http_code: '403',
    error: '',
  };

  assert.equal(
    classifyAuditEnvironment(Array.from({ length: 19 }, () => networkFailure)).status,
    'usable',
  );
  assert.equal(
    classifyAuditEnvironment([
      ...Array.from({ length: 16 }, () => networkFailure),
      ...Array.from({ length: 4 }, () => httpFailure),
    ]).status,
    'environment_failure',
  );
  assert.equal(
    classifyAuditEnvironment([
      ...Array.from({ length: 15 }, () => networkFailure),
      ...Array.from({ length: 5 }, () => httpFailure),
    ]).status,
    'usable',
  );
  assert.equal(
    classifyAuditEnvironment(Array.from({ length: 20 }, () => httpFailure)).status,
    'usable',
  );
});

test('a complete environment-failed audit preserves canonical evidence and writes only a preview', async () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-portal-audit-'));
  const canonical = join(root, 'data', 'source-health.tsv');
  const preview = join(root, 'reports', 'source-health-preview.tsv');
  const companies = Array.from({ length: 20 }, (_, index) => [
    `  - name: Source ${index + 1}`,
    `    careers_url: https://192.0.2.${index + 1}/jobs`,
  ].join('\n')).join('\n');
  let fetchCalls = 0;

  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'portals.yml'), `tracked_companies:\n${companies}\n`, 'utf8');
  writeFileSync(canonical, 'previous canonical evidence\n', 'utf8');

  try {
    const result = await runPortalAudit({
      projectRoot: root,
      concurrency: 4,
      fetchSource: async () => {
        fetchCalls += 1;
        const error = new Error('connect EACCES 203.0.113.10:443');
        error.code = 'EACCES';
        throw error;
      },
    });

    assert.equal(fetchCalls, 20);
    assert.equal(result.environment.status, 'environment_failure');
    assert.equal(result.canonical_write_blocked, true);
    assert.equal(readFileSync(canonical, 'utf8'), 'previous canonical evidence\n');
    assert.equal(existsSync(preview), true);
    assert.match(readFileSync(preview, 'utf8'), /Source 20/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows path casing cannot bypass the canonical environment-failure guard', {
  skip: process.platform !== 'win32',
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-portal-audit-case-'));
  const canonical = join(root, 'data', 'source-health.tsv');
  const companies = Array.from({ length: 20 }, (_, index) => [
    `  - name: Source ${index + 1}`,
    `    careers_url: https://192.0.2.${index + 1}/jobs`,
  ].join('\n')).join('\n');

  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'portals.yml'), `tracked_companies:\n${companies}\n`, 'utf8');
  writeFileSync(canonical, 'previous canonical evidence\n', 'utf8');

  try {
    const result = await runPortalAudit({
      projectRoot: root,
      outputPath: join('DATA', 'source-health.tsv'),
      fetchSource: async () => {
        throw new Error('connect EACCES 203.0.113.10:443');
      },
    });

    assert.equal(result.canonical_write_blocked, true);
    assert.equal(readFileSync(canonical, 'utf8'), 'previous canonical evidence\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
