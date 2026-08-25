import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  deriveSourceCaptureStatus,
  loadSourceCaptures,
  normalizeDiscoveryLane,
  recordSourceCapture,
} from '../lib/source-provenance.mjs';

test('normalizes only supported discovery lanes', () => {
  assert.equal(normalizeDiscoveryLane('LinkedIn'), 'linkedin');
  assert.equal(normalizeDiscoveryLane('IEFP Online'), 'iefp');
  assert.equal(normalizeDiscoveryLane('Net-Empregos'), 'net_empregos');
  assert.equal(normalizeDiscoveryLane('untrusted-source'), '');
});

test('derives qualified capture status from the same quality and fit boundary', () => {
  assert.equal(deriveSourceCaptureStatus({ quality: { passed: false } }), 'skipped_low_quality');
  assert.equal(deriveSourceCaptureStatus({ quality: { passed: true }, evaluation: { score: 52, recommendation: 'maybe' }, minScore: 60 }), 'skipped_low_fit');
  assert.equal(deriveSourceCaptureStatus({ quality: { passed: true }, evaluation: { score: 81, recommendation: 'apply' }, minScore: 60 }), 'evaluated');
  assert.equal(deriveSourceCaptureStatus({ quality: { passed: true }, evaluation: { score: 90, recommendation: 'discard' }, minScore: 60 }), 'skipped_low_fit');
});

test('persists sanitized source captures atomically and replaces duplicate lane plus canonical URL', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-provenance-'));
  const first = recordSourceCapture({
    projectRoot: root,
    capturedAt: '2026-08-25T10:00:00.000Z',
    discoveredVia: 'LinkedIn',
    canonicalUrl: 'https://boards.greenhouse.io/example/jobs/42?gh_jid=42',
    company: 'Example\tCompany',
    title: 'Junior\nEngineer',
    status: 'evaluated',
    qualityScore: 90,
    fitScore: 81.5,
  });

  assert.equal(first.recorded, true);
  assert.equal(first.replaced, false);
  assert.equal(first.capture.discovered_via, 'linkedin');
  assert.equal(first.capture.company, 'Example Company');
  assert.equal(first.capture.title, 'Junior Engineer');

  const second = recordSourceCapture({
    projectRoot: root,
    capturedAt: '2026-08-25T11:00:00.000Z',
    discoveredVia: 'linkedin',
    canonicalUrl: 'https://boards.greenhouse.io/example/jobs/42?gh_jid=42',
    company: 'Example Company',
    title: 'Junior Engineer',
    status: 'skipped_low_fit',
    qualityScore: 90,
    fitScore: 52,
  });

  assert.equal(second.replaced, true);
  const file = join(root, 'data', 'source-captures.tsv');
  const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /2026-08-25T11:00:00\.000Z\tlinkedin\t/);
  assert.match(lines[1], /\tskipped_low_fit\t90\t52$/);
});

test('ignores malformed persisted rows and never turns them into coverage', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-provenance-malformed-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', 'source-captures.tsv'), [
    'captured_at\tdiscovered_via\tcanonical_url\tcompany\ttitle\tstatus\tquality_score\tfit_score',
    '2026-08-25T10:00:00.000Z\tlinkedin\thttps://jobs.example.com/1\tExample\tRole\tevaluated\t90\t80',
    'not-a-date\tunknown\tno-url\tBroken\tRole\tevaluated\t90\t80',
  ].join('\n'));

  const result = loadSourceCaptures(root);
  assert.equal(result.captures.length, 1);
  assert.equal(result.captures[0].discovered_via, 'linkedin');
  assert.equal(result.warnings.length, 1);
});
