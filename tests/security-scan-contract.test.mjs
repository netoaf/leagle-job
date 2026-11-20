import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('security scan is documented, invocable and keeps its local binary out of Git', () => {
  const scriptPath = join(projectRoot, 'scripts', 'security-scan.ps1');
  assert.equal(existsSync(scriptPath), true, 'missing scripts/security-scan.ps1');

  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['security:scan'],
    'powershell -ExecutionPolicy Bypass -File scripts/security-scan.ps1',
  );

  const gitignore = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
  assert.match(gitignore, /^tools\/gitleaks\/$/m);

  const script = readFileSync(scriptPath, 'utf8');
  assert.match(script, /--redact/);
  assert.match(script, /--log-opts=--all/);
  assert.match(script, /--exit-code 1/);
});

test('security scan scopes Git safe-directory trust to its child process', { skip: process.platform !== 'win32' }, () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'leagle-job-security-scan-'));
  const fakeGitleaksPath = join(fixtureRoot, 'fake-gitleaks.ps1');
  const expectedRoot = fixtureRoot.replaceAll('\\', '/');

  writeFileSync(fakeGitleaksPath, [
    "if ($env:GIT_CONFIG_COUNT -ne '1') { throw 'GIT_CONFIG_COUNT was not scoped' }",
    "if ($env:GIT_CONFIG_KEY_0 -ne 'safe.directory') { throw 'safe.directory key was not scoped' }",
    `if ($env:GIT_CONFIG_VALUE_0 -ne '${expectedRoot}') { throw 'safe.directory path was not scoped' }`,
  ].join('\r\n'));

  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'scripts', 'security-scan.ps1'), '-ProjectRoot', fixtureRoot],
      {
        env: {
          ...process.env,
          JOBFINDER_GITLEAKS: fakeGitleaksPath,
          GIT_CONFIG_COUNT: '',
          GIT_CONFIG_KEY_0: '',
          GIT_CONFIG_VALUE_0: '',
        },
        stdio: 'pipe',
      },
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
