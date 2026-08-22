import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
