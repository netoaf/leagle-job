import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('parses and validates explicit discovery provenance before evaluation', async () => {
  const { parseArgs, resolveDiscoveryLane } = await import('../evaluate-url.mjs');
  const options = parseArgs([
    '--url', 'https://boards.greenhouse.io/example/jobs/42',
    '--discovered-via', 'IEFP Online',
    '--write',
  ]);

  assert.equal(options.discoveredVia, 'IEFP Online');
  assert.equal(resolveDiscoveryLane(options.discoveredVia), 'iefp');
  assert.throws(() => resolveDiscoveryLane('untrusted-source'), /supported --discovered-via/);
});

test('persists only intentional evaluate-url provenance before dashboard promotion', async () => {
  const { persistEvaluateUrlProvenance } = await import('../evaluate-url.mjs');
  const root = mkdtempSync(join(tmpdir(), 'leagle-evaluate-provenance-'));
  const common = {
    projectRoot: root,
    extraction: { final_url: 'https://boards.greenhouse.io/example/jobs/42' },
    job: {
      canonical_url: 'https://boards.greenhouse.io/example/jobs/42',
      company: 'Example',
      title: 'Junior Engineer',
    },
    quality: { passed: true, quality_score: 91 },
    evaluation: { score: 82, recommendation: 'apply' },
    minScore: 60,
  };

  assert.equal(persistEvaluateUrlProvenance({ ...common, options: { discoveredVia: 'linkedin' } }), null);

  const stored = persistEvaluateUrlProvenance({
    ...common,
    options: { discoveredVia: 'linkedin', dashboard: true },
  });

  assert.equal(stored.recorded, true);
  assert.equal(stored.capture.discovered_via, 'linkedin');
  assert.equal(stored.capture.status, 'evaluated');
  assert.equal(stored.capture.canonical_url, common.job.canonical_url);
});
