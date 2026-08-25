import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexPrompt, runCommand } from '../prepare-portal-application.mjs';

test('portal prompt permits safe field preparation but forbids file upload, final submission and invention', () => {
  const prompt = buildCodexPrompt({
    root: 'C:/repo',
    application: { id: 72, company: 'Capgemini', role: 'Curricular Internship - Testing' },
    action: { channel: 'official_portal', apply_url: 'https://example.com/apply' },
    reportFile: 'C:/repo/reports/072.md',
    cvFile: 'C:/repo/output/cv.pdf',
  });

  assert.match(prompt, /preenche apenas factos confirmados/i);
  assert.match(prompt, /deve anexar exatamente este CV/i);
  assert.match(prompt, /não carregues ficheiros/i);
  assert.match(prompt, /proibido clicar no botão final/i);
  assert.match(prompt, /inventar respostas/i);
  assert.match(prompt, /questions/i);
});

test('portal command closes stdin so a child waiting for EOF can start', async () => {
  const execution = await runCommand(process.execPath, [
    '-e',
    "process.stdin.resume(); process.stdin.on('end', () => console.log('stdin-closed'));",
  ], { timeoutMs: 2_000 });

  assert.equal(execution.code, 0);
  assert.match(execution.stdout, /stdin-closed/);
  assert.doesNotMatch(execution.stderr, /Tempo limite excedido/);
});
