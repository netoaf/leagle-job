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
