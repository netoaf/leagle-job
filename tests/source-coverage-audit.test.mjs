import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { auditSourceCoverage } from '../source-coverage-audit.mjs';

test('coverage audit fails visibly when major Portuguese lanes are missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-coverage-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'data', 'scan-history.tsv'), 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://pt.linkedin.com/jobs/view/1\t2026-08-07\tLinkedIn\tRole\tCompany\tevaluated\n');
  writeFileSync(join(root, 'data', 'source-health.tsv'), 'company\tlast_checked\nExample\t2026-07-20T00:00:00Z\n');
  writeFileSync(join(root, 'config', 'browser-use.yml'), 'enabled: false\n');

  const result = auditSourceCoverage({ projectRoot: root, now: '2026-08-07T12:00:00Z', days: 7 });
  assert.equal(result.status, 'degraded');
  assert.equal(result.lanes.find((lane) => lane.id === 'linkedin').count, 1);
  assert.equal(result.lanes.find((lane) => lane.id === 'linkedin').qualified_count, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('IEFP Online')));
  assert.ok(result.warnings.some((warning) => warning.includes('Source-health evidence is stale')));
});

test('does not count expired or low-quality captures as coverage', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-coverage-quality-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'data', 'scan-history.tsv'), [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
    'https://pt.linkedin.com/jobs/view/1\t2026-08-07\tLinkedIn\tRole\tCompany\tskipped_low_quality',
    'https://pt.linkedin.com/jobs/view/2\t2026-08-07\tLinkedIn\tRole\tCompany\texpired',
  ].join('\n'));
  writeFileSync(join(root, 'data', 'source-health.tsv'), 'company\tlast_checked\nExample\t2026-08-07T00:00:00Z\n');
  writeFileSync(join(root, 'config', 'browser-use.yml'), 'enabled: true\n');

  const result = auditSourceCoverage({ projectRoot: root, now: '2026-08-07T12:00:00Z', days: 7 });
  const linkedin = result.lanes.find((lane) => lane.id === 'linkedin');
  assert.equal(linkedin.captured_count, 2);
  assert.equal(linkedin.qualified_count, 0);
  assert.equal(linkedin.status, 'undercovered');
});
