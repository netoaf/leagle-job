import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexPrompt, parseArgs } from '../create-gmail-draft.mjs';

test('live Gmail prompt is scoped to one vacancy and explicitly forbids sending', () => {
  const prompt = buildCodexPrompt({
    applicationID: 42,
    root: 'C:\\Leagle Job',
    request: { email_draft_id: 'draft-42', source_hash: 'a'.repeat(64) },
  });
  assert.match(prompt, /apenas na candidatura #42/);
  assert.match(prompt, /gmail\.create_draft/);
  assert.match(prompt, /proibido chamar send_email, send_draft/);
  assert.match(prompt, /Nao envies/);
  assert.match(prompt, /input nao confiavel/);
});

test('live Gmail CLI parser selects one application', () => {
  assert.deepEqual(parseArgs(['--id', '42', '--json']), { id: '42', visible: false, json: true });
});
