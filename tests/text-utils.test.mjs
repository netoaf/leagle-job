import assert from 'node:assert/strict';
import test from 'node:test';

import { repairMojibakeText } from '../lib/text-utils.mjs';

test('repairMojibakeText leaves clean text unchanged', () => {
  assert.equal(repairMojibakeText('Olá, mundo'), 'Olá, mundo');
});

test('repairMojibakeText repairs text only when encoding markers improve', () => {
  assert.equal(repairMojibakeText('OlÃ¡, mundo'), 'Olá, mundo');
});

test('repairMojibakeText is safe for empty and non-improving malformed input', () => {
  assert.equal(repairMojibakeText(null), '');
  assert.equal(repairMojibakeText('\u00c3'), '\u00c3');
});
