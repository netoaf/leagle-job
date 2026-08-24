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
  assert.match(currentStatus, /\| Node unit suite \| 123 passing, 0 failing \|/);
  assert.match(releaseNotes, /^Status: release candidate$/m);
  assert.doesNotMatch(releaseNotes, /^Release date:/m);
});
