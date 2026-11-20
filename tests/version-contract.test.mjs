import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('release version is consistent across package manifests', () => {
  const releaseVersion = readFileSync(join(projectRoot, 'VERSION'), 'utf8').trim();
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));

  assert.equal(packageJson.version, releaseVersion);
  assert.equal(packageLock.version, releaseVersion);
  assert.equal(packageLock.packages[''].version, releaseVersion);
});

test('release-candidate documentation matches the verified checkout', () => {
  const architecture = readFileSync(join(projectRoot, 'docs', 'ARCHITECTURE.md'), 'utf8');
  const currentStatus = readFileSync(join(projectRoot, 'docs', 'CURRENT-STATUS.md'), 'utf8');
  const releaseNotes = readFileSync(join(projectRoot, 'docs', 'RELEASE-NOTES-V1.4.1.md'), 'utf8');

  assert.match(architecture, /`lib\/network\/safe-fetch\.mjs`/);
  assert.doesNotMatch(architecture, /`lib\/safe-fetch\.mjs`/);
  assert.match(currentStatus, /\| Node unit suite \| 144 passing, 0 failing \|/);
  assert.match(currentStatus, /\| Product health \| 16\/16 checks passing \|/);
  assert.match(currentStatus, /\| Product suite \| 101 passing, 0 failing, 0 warnings \|/);
  assert.match(currentStatus, /\| Pipeline reconciliation \| 0 errors, 0 warnings across 137 tracker entries \|/);
  assert.match(currentStatus, /\| Secret scan \| 24 reachable Git commits scanned with no leaks \|/);
  assert.match(releaseNotes, /^Status: release candidate$/m);
  assert.match(releaseNotes, /^Candidate verified: 2026-08-25$/m);
  assert.match(releaseNotes, /- Node unit suite: 144 passed, 0 failed\./);
  assert.match(releaseNotes, /- Product health: 16\/16 checks passed\./);
  assert.match(releaseNotes, /- Product suite: 101 passed, 0 failed, 0 warnings\./);
  assert.match(releaseNotes, /- Pipeline reconciliation: 0 errors, 0 warnings across 137 tracker entries\./);
  assert.match(releaseNotes, /- Redacted Gitleaks scan: 24 Git commits scanned, no leaks found\./);
  assert.doesNotMatch(releaseNotes, /^Release date:/m);
});
