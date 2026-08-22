import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDraftQualityGate } from '../draft-quality-gate.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function pack(channel) {
  return `# Application Pack

**Company:** Example
**Role:** Junior Developer
**Score:** 80/100
**Status:** Evaluated
**Application Channel:** ${channel}
**Pack Status:** Needs human review

## Decision

- Do not send automatically.
- Do not upload CV automatically.

## Email Draft

a confirmar
`;
}

test('portal application packs do not require an email draft', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leagle-draft-channel-'));
  const file = join(dir, 'portal-pack.md');
  writeFileSync(file, pack('official_portal'), 'utf8');

  const result = runDraftQualityGate({ projectRoot, files: [file] });
  const codes = result.results[0].issues.map((issue) => issue.code);

  assert.equal(codes.includes('placeholder_email_draft'), false);
  assert.equal(codes.includes('draft_too_short'), false);
  assert.equal(codes.includes('language_unknown'), false);
});

test('email application packs still fail closed without a reviewed draft', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leagle-draft-channel-'));
  const file = join(dir, 'email-pack.md');
  writeFileSync(file, pack('email'), 'utf8');

  const result = runDraftQualityGate({ projectRoot, files: [file] });
  const codes = result.results[0].issues.map((issue) => issue.code);

  assert.equal(codes.includes('placeholder_email_draft'), true);
});
