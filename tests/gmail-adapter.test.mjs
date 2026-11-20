import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  prepareGmailDraftRequests,
  readyGmailDraftRequests,
  recordCodexReviews,
  recordGmailDraftResults,
} from '../gmail-adapter.mjs';
import { loadEmailDrafts, upsertEmailDrafts } from '../lib/email/email-draft-store.mjs';
import { loadEmailConfig } from '../lib/email/email-policy.mjs';

test('Gmail adapter requires a fresh vacancy, deterministic attachment and Codex review before an unsent draft', () => {
  const root = fixture();
  try {
    const prepared = prepareGmailDraftRequests({ projectRoot: root });
    assert.equal(prepared.counts.needs_codex_review, 1);
    const request = prepared.requests[0];
    assert.equal(request.action, 'gmail.create_draft');
    assert.match(request.connector_rule, /Never call send_draft/);
    assert.equal(request.attachment_sha256.length, 64);

    recordCodexReviews({
      email_draft_id: request.email_draft_id,
      source_hash: request.source_hash,
      decision: 'ready_for_gmail_draft',
      recommendations: [],
      unsupported_claims: [],
      gmail_draft_allowed: true,
      model: 'test-model',
    }, { projectRoot: root });

    const ready = readyGmailDraftRequests({ projectRoot: root });
    assert.equal(ready.counts.ready, 1);
    assert.equal(ready.requests[0].body.includes('Do not send automatically'), false);

    recordGmailDraftResults({
      email_draft_id: request.email_draft_id,
      source_hash: request.source_hash,
      gmail_draft_id: 'draft-123',
      gmail_message_id: 'message-123',
      gmail_thread_id: 'thread-123',
      created_at: new Date().toISOString(),
    }, { projectRoot: root });

    const drafts = loadEmailDrafts(root, loadEmailConfig(root));
    const stored = drafts.get('001');
    assert.equal(stored.status, 'gmail_draft_created');
    assert.equal(stored.gmail_draft_id, 'draft-123');
    assert.equal(stored.gmail_thread_id, 'thread-123');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gmail adapter rejects a stale Codex review hash', () => {
  const root = fixture();
  try {
    const request = prepareGmailDraftRequests({ projectRoot: root, dryRun: true }).requests[0];
    assert.throws(() => recordCodexReviews({
      email_draft_id: request.email_draft_id,
      source_hash: '0'.repeat(64),
      decision: 'ready_for_gmail_draft',
      unsupported_claims: [],
      gmail_draft_allowed: true,
    }, { projectRoot: root }), /stale_codex_review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('historical sent record with empty local paths is blocked instead of reading the project directory', () => {
  const root = fixture();
  try {
    const config = loadEmailConfig(root);
    const drafts = loadEmailDrafts(root, config);
    upsertEmailDrafts(root, [{
      ...drafts.get('001'),
      status: 'sent_manually',
      body_file: '',
      planned_attachment: '',
    }], config);
    const result = prepareGmailDraftRequests({ projectRoot: root, dryRun: true });
    assert.equal(result.counts.blocked, 1);
    assert.ok(result.requests[0].blockers.includes('missing_local_draft'));
    assert.ok(result.requests[0].blockers.includes('missing_attachment'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'leagle-gmail-adapter-'));
  for (const directory of [
    'config',
    'data',
    'reports',
    'output/application-packs',
    'output/email-drafts-local',
    'output/cv-library/EN',
  ]) mkdirSync(join(root, directory), { recursive: true });

  writeFileSync(join(root, 'config', 'profile.yml'), `
candidate:
  email: "candidate@example.com"
documents:
  cv_library:
    en:
      backend: "output/cv-library/EN/CV-EN-Backend.pdf"
`, 'utf-8');
  writeFileSync(join(root, 'config', 'scoring.yml'), '', 'utf-8');
  writeFileSync(join(root, 'config', 'jobfinder-rules.yml'), '', 'utf-8');
  writeFileSync(join(root, 'config', 'email.yml'), `
enabled: true
provider: gmail
mode: draft_only
human_review_required: true
auto_send: false
allow_real_gmail_drafts: true
allow_cv_attachment_in_gmail: true
adapter:
  transport: codex_gmail_connector
  requests_dir: output/gmail-adapter/draft-requests
  reviews_dir: output/gmail-adapter/reviews
  results_dir: output/gmail-adapter/results
attachments:
  strategy: deterministic_cv_selector
  require_explicit_attachment_approval: false
  require_sha256: true
sync:
  read_replies: true
  update_application_status: true
followups:
  enabled: true
  auto_create_drafts: true
safety:
  require_draft_quality_gate: true
  require_application_pack: true
  require_vacancy_verified: true
  require_live_vacancy_verified: true
  live_verification_method: playwright
  live_verification_max_age_minutes: 15
  never_send_without_approval: true
`, 'utf-8');
  writeFileSync(join(root, 'output', 'cv-library', 'EN', 'CV-EN-Backend.pdf'), 'pdf fixture', 'utf-8');
  writeFileSync(join(root, 'output', 'email-drafts-local', '001-example-role.md'), `
# Local Email Draft

## Envelope

To: jobs@example.com
Subject: Application - Junior Backend Developer

## Body

Hello,

I am applying for the Junior Backend Developer position. My academic and personal projects gave me practical experience with JavaScript, Node.js, REST APIs and SQL. I would welcome the opportunity to learn with your engineering team and contribute responsibly.

Kind regards,
Example Candidate
`, 'utf-8');
  writeFileSync(join(root, 'output', 'application-packs', '001-example-role.md'), `
**Company:** Example Ltd
**Role:** Junior Backend Developer
**Status:** Needs human review

Do not send automatically.
Do not upload CV automatically.

## Email Draft

Subject: Application - Junior Backend Developer

Hello,

I am applying for the Junior Backend Developer position. My academic and personal projects gave me practical experience with JavaScript, Node.js, REST APIs and SQL. I would welcome the opportunity to learn with your engineering team and contribute responsibly.

Kind regards,
Example Candidate
`, 'utf-8');
  writeFileSync(join(root, 'reports', '001.md'), '**URL:** https://example.com/jobs/1\n', 'utf-8');
  const verifiedAt = new Date().toISOString();
  writeFileSync(join(root, 'data', 'applications.md'), `
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
| 1 | 2026-08-07 | Example Ltd | Junior Backend Developer | 90 | Evaluated | yes | [001](reports/001.md) | [live-verified:${verifiedAt}] [live-method:playwright] [live-state:active] |
`, 'utf-8');

  const config = loadEmailConfig(root);
  upsertEmailDrafts(root, [{
    id: 'ED-0001',
    application_id: '1',
    report_number: '001',
    company: 'Example Ltd',
    role: 'Junior Backend Developer',
    status: 'local_ready',
    provider: 'gmail',
    to: 'jobs@example.com',
    subject: 'Application - Junior Backend Developer',
    body_file: 'output/email-drafts-local/001-example-role.md',
    planned_attachment: 'output/cv-library/EN/CV-EN-Backend.pdf',
    gmail_draft_id: '',
    created_at: '2026-08-07',
    updated_at: '2026-08-07',
    review_required: 'yes',
    quality_gate_status: 'pending',
    notes: '',
  }], config);
  assert.match(readFileSync(join(root, 'data', 'email-drafts.tsv'), 'utf-8'), /ED-0001/);
  return root;
}
