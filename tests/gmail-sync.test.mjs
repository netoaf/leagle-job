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
  buildAutomaticFollowupPlan,
  buildGmailSyncPlan,
  importGmailEvents,
  recordAutomaticFollowupDrafts,
} from '../gmail-sync.mjs';
import { loadEmailDrafts, upsertEmailDrafts } from '../lib/email/email-draft-store.mjs';
import { loadEmailConfig } from '../lib/email/email-policy.mjs';
import { loadFollowups, writeFollowups } from '../follow-up-tracker.mjs';

test('Gmail sync detects sent and human reply events, advances status and recommends the next step', () => {
  const root = fixture();
  try {
    const sentAt = '2026-08-07T10:00:00.000Z';
    const sent = importGmailEvents({
      events: [{
        email_draft_id: 'ED-0001',
        type: 'sent',
        classification: 'sent',
        message_id: 'sent-1',
        thread_id: 'thread-1',
        from: 'candidate@example.com',
        to: 'jobs@example.com',
        subject: 'Application - Junior Backend Developer',
        occurred_at: sentAt,
      }],
    }, { projectRoot: root });
    assert.deepEqual(sent.imported, ['sent-1']);
    assert.match(readFileSync(join(root, 'data', 'applications.md'), 'utf-8'), /\| Applied \|/);
    const sentDraft = loadEmailDrafts(root, loadEmailConfig(root)).get('001');
    assert.equal(sentDraft.status, 'sent_manually');
    assert.equal(sentDraft.gmail_message_id, 'sent-1');
    assert.equal(sentDraft.gmail_thread_id, 'thread-1');

    const afterSent = loadFollowups(root).get('001');
    assert.equal(afterSent.applied_at, '2026-08-07');
    assert.equal(afterSent.followup_due, '2026-08-14');
    assert.equal(afterSent.response_state, 'waiting_for_reply');

    const reply = importGmailEvents({
      events: [{
        email_draft_id: 'ED-0001',
        type: 'reply',
        classification: 'interview_invite',
        message_id: 'reply-1',
        thread_id: 'thread-1',
        from: 'jobs@example.com',
        to: 'candidate@example.com',
        subject: 'Re: Application - Junior Backend Developer',
        occurred_at: '2026-08-08T09:00:00.000Z',
        snippet: 'Please choose an interview time.',
      }],
    }, { projectRoot: root });
    assert.deepEqual(reply.imported, ['reply-1']);
    assert.match(readFileSync(join(root, 'data', 'applications.md'), 'utf-8'), /\| Responded \|/);
    const afterReply = loadFollowups(root).get('001');
    assert.equal(afterReply.response_state, 'interview_invite');
    assert.match(afterReply.recommendation, /Prioridade alta/);

    const duplicate = importGmailEvents({
      events: [{
        email_draft_id: 'ED-0001',
        type: 'reply',
        classification: 'interview_invite',
        message_id: 'reply-1',
        thread_id: 'thread-1',
        from: 'jobs@example.com',
        to: 'candidate@example.com',
        subject: 'Re: Application - Junior Backend Developer',
        occurred_at: '2026-08-08T09:00:00.000Z',
      }],
    }, { projectRoot: root });
    assert.equal(duplicate.skipped_duplicates, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('due follow-up creates an idempotent draft plan but never sends', () => {
  const root = fixture({ signatureName: 'Example Candidate' });
  try {
    const config = loadEmailConfig(root);
    const drafts = loadEmailDrafts(root, config);
    upsertEmailDrafts(root, [{
      ...drafts.get('001'),
      status: 'sent_manually',
      gmail_message_id: 'sent-1',
      gmail_thread_id: 'thread-1',
    }], config);
    writeFileSync(join(root, 'data', 'applications.md'), `
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
| 1 | 2026-08-07 | Example Ltd | Junior Backend Developer | 90 | Applied | yes | [001](reports/001.md) | |
`, 'utf-8');
    const records = loadFollowups(root);
    records.set('001', {
      id: '1',
      report_number: '001',
      company: 'Example Ltd',
      role: 'Junior Backend Developer',
      applied_at: '2026-07-30',
      last_contact: '2026-07-30',
      followup_due: '2026-08-01',
      contact_channel: 'email',
      contact_name: 'jobs@example.com',
      next_action: '',
      notes: '',
      updated_at: '2026-08-01',
      gmail_thread_id: 'thread-1',
      last_message_id: 'sent-1',
      followup_draft_id: '',
      response_state: 'waiting_for_reply',
      recommendation: '',
      synced_at: '',
    });
    writeFollowups(root, records);

    const plan = buildAutomaticFollowupPlan({ projectRoot: root });
    assert.equal(plan.requests.length, 1);
    assert.equal(plan.requests[0].reply_message_id, 'sent-1');
    assert.match(plan.requests[0].connector_rule, /Never call send_draft/);
    assert.match(plan.requests[0].body, /Example Candidate/);

    recordAutomaticFollowupDrafts({
      followup_id: 'FU-001',
      source_hash: plan.requests[0].source_hash,
      gmail_draft_id: 'followup-draft-1',
      codex_review: {
        source_hash: plan.requests[0].source_hash,
        decision: 'ready_for_gmail_draft',
        gmail_draft_allowed: true,
        unsupported_claims: [],
      },
    }, { projectRoot: root });

    assert.equal(loadFollowups(root).get('001').followup_draft_id, 'followup-draft-1');
    assert.equal(buildAutomaticFollowupPlan({ projectRoot: root }).requests.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('historical manual send can be imported by application id without a pre-existing draft row', () => {
  const root = fixture({ withDraft: false });
  try {
    const result = importGmailEvents({
      events: [{
        application_id: '1',
        type: 'sent',
        classification: 'sent',
        message_id: 'legacy-sent-1',
        thread_id: 'legacy-thread-1',
        from: 'candidate@example.com',
        to: 'jobs@example.com',
        subject: 'Application - Junior Backend Developer',
        occurred_at: '2026-08-07T10:00:00.000Z',
      }],
    }, { projectRoot: root });
    assert.deepEqual(result.imported, ['legacy-sent-1']);
    const drafts = [...loadEmailDrafts(root, loadEmailConfig(root)).values()];
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].status, 'sent_manually');
    assert.equal(drafts[0].quality_gate_status, 'legacy_manual_send');
    assert.equal(drafts[0].gmail_thread_id, 'legacy-thread-1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync plan exposes an orphan scheduled email fail-closed', () => {
  const root = fixture({ withDraft: false });
  try {
    writeFileSync(join(root, 'data', 'applications.md'), `
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
| 1 | 2026-08-08 | Example Ltd | Junior Backend Developer | 90 | Scheduled | yes | [001](reports/001.md) | [scheduled:gmail:2026-08-08T08:00:00+01:00] Email agendado para jobs@example.com. |
`, 'utf-8');
    const plan = buildGmailSyncPlan({ projectRoot: root });
    assert.equal(plan.searches.length, 1);
    assert.equal(plan.searches[0].application_id, '1');
    assert.equal(plan.searches[0].email_draft_id, '');
    assert.match(plan.searches[0].sent_query, /to:jobs@example\.com/);
    assert.equal(plan.searches[0].recovery_reason, 'scheduled_application_missing_email_draft_record');
    assert.match(plan.searches[0].matching_rule, /Fail closed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sent detection never schedules follow-up for a vacancy already confirmed closed', () => {
  const root = fixture({ withDraft: false, closed: true });
  try {
    importGmailEvents({
      events: [{
        application_id: '1',
        type: 'sent',
        classification: 'sent',
        message_id: 'closed-sent-1',
        thread_id: 'closed-thread-1',
        from: 'candidate@example.com',
        to: 'jobs@example.com',
        subject: 'Application - Junior Backend Developer',
        occurred_at: '2026-08-07T10:00:00.000Z',
      }],
    }, { projectRoot: root });
    const followup = loadFollowups(root).get('001');
    assert.equal(followup.followup_due, '');
    assert.equal(followup.response_state, 'closed_no_followup');
    assert.match(followup.next_action, /Sem follow-up/);
    assert.equal(buildAutomaticFollowupPlan({ projectRoot: root }).requests.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'leagle-gmail-sync-'));
  for (const directory of ['config', 'data', 'reports']) {
    mkdirSync(join(root, directory), { recursive: true });
  }
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
attachments:
  strategy: deterministic_cv_selector
  require_explicit_attachment_approval: false
  require_sha256: true
sync:
  read_replies: true
  update_application_status: true
  newer_than_days: 30
followups:
  enabled: true
  auto_create_drafts: true
  signature_name: "${options.signatureName || ''}"
  no_response_after_days: 7
  reply_action_due_days: 2
safety:
  require_vacancy_verified: true
  require_live_vacancy_verified: true
  live_verification_method: playwright
  live_verification_max_age_minutes: 15
  never_send_without_approval: true
`, 'utf-8');
  writeFileSync(join(root, 'data', 'applications.md'), `
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
| 1 | 2026-08-07 | Example Ltd | Junior Backend Developer | 90 | Evaluated | yes | [001](reports/001.md) | ${options.closed ? '[live-state:closed] Não fazer follow-up desta vaga.' : ''} |
`, 'utf-8');
  writeFileSync(join(root, 'data', 'application-followups.tsv'), 'id\treport_number\tcompany\trole\tapplied_at\tlast_contact\tfollowup_due\tcontact_channel\tcontact_name\tnext_action\tnotes\tupdated_at\n', 'utf-8');
  if (options.withDraft !== false) {
    const config = loadEmailConfig(root);
    upsertEmailDrafts(root, [{
      id: 'ED-0001',
      application_id: '1',
      report_number: '001',
      company: 'Example Ltd',
      role: 'Junior Backend Developer',
      status: 'gmail_draft_created',
      provider: 'gmail',
      to: 'jobs@example.com',
      subject: 'Application - Junior Backend Developer',
      body_file: 'output/draft.md',
      planned_attachment: 'output/cv.pdf',
      gmail_draft_id: 'draft-1',
      created_at: '2026-08-07',
      updated_at: '2026-08-07',
      review_required: 'yes',
      quality_gate_status: 'passed',
      notes: '',
    }], config);
  }
  return root;
}
