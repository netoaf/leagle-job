import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hasApplicationChannel, roleAppearsOnPage } from '../check-liveness.mjs';
import { updateTrackerVerification } from '../verify-and-draft.mjs';

test('role matching requires the selected role to appear in rendered content', () => {
  assert.equal(
    roleAppearsOnPage(
      'Junior Backend Developer',
      'Join our team as a Junior Backend Developer. Apply now.',
      'Careers',
    ),
    true,
  );
  assert.equal(
    roleAppearsOnPage(
      'Junior Backend Developer',
      'Sign in to see jobs and update your profile.',
      'LinkedIn Login',
    ),
    false,
  );
});

test('recognizes the official Net-Empregos email reveal control as an application channel', () => {
  assert.equal(hasApplicationChannel('Envie o seu CV para Mostrar Email >'), true);
  assert.equal(hasApplicationChannel('Apenas descrição institucional da empresa.'), false);
});

test('tracker verification replaces stale markers and records the live state atomically', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-verify-draft-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'applications.md'), `
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
| 3 | 2026-08-07 | Empresa | Junior Developer | 90 | Evaluated | - | [003](reports/003.md) | Nota [live-verified:2026-08-01T10:00:00Z] [live-method:playwright] [live-state:active] |
`, 'utf-8');

    updateTrackerVerification(root, 3, {
      timestamp: '2026-08-07T15:00:00.000Z',
      state: 'expired',
      source: 'example.com',
      reason: 'HTTP 404',
    });

    const tracker = readFileSync(join(root, 'data', 'applications.md'), 'utf-8');
    assert.doesNotMatch(tracker, /2026-08-01/);
    assert.match(tracker, /\[live-checked:2026-08-07T15:00:00.000Z\]/);
    assert.match(tracker, /\[live-state:expired\]/);
    assert.match(tracker, /\[live-source:example.com\]/);
    assert.match(tracker, /HTTP 404/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
