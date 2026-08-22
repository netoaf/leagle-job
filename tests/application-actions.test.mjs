import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNextAction, extractActionStatus, inferApplicationChannel } from '../application-actions.mjs';
import { isActionableStatus, summarizeApplications } from '../lib/applications-store.mjs';

test('classifies LinkedIn application pages', () => {
  assert.equal(
    inferApplicationChannel('https://pt.linkedin.com/jobs/view/example-123'),
    'linkedin_apply',
  );
});

test('classifies supported job boards', () => {
  assert.equal(inferApplicationChannel('https://www.itjobs.pt/oferta/123/test'), 'job_board_apply');
  assert.equal(inferApplicationChannel('https://www.net-empregos.com/123/test/'), 'job_board_apply');
  assert.equal(inferApplicationChannel('https://pt.indeed.com/viewjob?jk=abc'), 'job_board_apply');
});

test('classifies official ATS and company career portals', () => {
  assert.equal(inferApplicationChannel('https://jobs.lever.co/example/123'), 'official_portal');
  assert.equal(inferApplicationChannel('https://careers.example.com/jobs/123'), 'official_portal');
  assert.equal(inferApplicationChannel('https://recrutamento.example.pt/jobs/123'), 'official_portal');
});

test('keeps unknown valid URLs explicit and missing URLs blocked', () => {
  assert.equal(inferApplicationChannel('https://example.com/opportunity/123'), 'manual_apply_url');
  assert.equal(inferApplicationChannel(''), 'needs_channel');
});

test('scheduled applications are tracked but cannot generate another application action', () => {
  assert.equal(isActionableStatus('Scheduled'), false);
  const summary = summarizeApplications([{ status: 'Scheduled', score_number: 80 }]);
  assert.equal(summary.scheduled, 1);
  assert.equal(summary.actionable, 0);
});

test('explicit audited action status overrides generic inference', () => {
  assert.equal(extractActionStatus('[cv:en] [action:ready_portal_prepare] PRIORIDADE'), 'ready_portal_prepare');
  assert.equal(extractActionStatus('[action:needs_linkedin_verification] HOLD'), 'needs_linkedin_verification');
  assert.equal(extractActionStatus('sem marcador'), '');
});

test('portal next actions stop before CV upload', () => {
  const action = buildNextAction('ready_manual_review', 'official_portal').toLowerCase();
  assert.match(action, /indicar/);
  assert.match(action, /antes do upload/);
  assert.doesNotMatch(action, /anexar/);
});
