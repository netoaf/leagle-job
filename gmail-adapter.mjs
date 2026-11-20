#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadApplications } from './lib/applications-store.mjs';
import {
  loadEmailConfig,
  assertEmailPolicy,
} from './lib/email/email-policy.mjs';
import {
  loadEmailDrafts,
  upsertEmailDrafts,
} from './lib/email/email-draft-store.mjs';
import { runDraftQualityGate } from './draft-quality-gate.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const ALLOWED_REVIEW_DECISIONS = new Set(['ready_for_gmail_draft', 'revise', 'block']);

export function prepareGmailDraftRequests(options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadEmailConfig(root);
  assertAdapterPolicy(config);
  const selected = selectDrafts(root, config, options);
  const requests = selected.map((record) => buildDraftRequest(root, config, record));

  if (!options.dryRun) {
    for (const request of requests) {
      const file = requestFile(root, config, request.email_draft_id);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(request, null, 2)}\n`, 'utf-8');
    }
    upsertEmailDrafts(root, requests.map((request) => ({
      ...request.record_update,
      updated_at: todayISO(),
    })), config);
  }

  return summarizeRequests(requests, options.dryRun);
}

export function readyGmailDraftRequests(options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadEmailConfig(root);
  assertAdapterPolicy(config);
  const selected = selectDrafts(root, config, options);
  const requests = selected.map((record) => {
    const request = buildDraftRequest(root, config, record);
    if (request.status === 'blocked') return request;
    return applyCodexReview(root, config, request);
  });
  return summarizeRequests(requests, true);
}

export function recordCodexReviews(reviewInput, options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadEmailConfig(root);
  assertAdapterPolicy(config);
  const reviews = Array.isArray(reviewInput) ? reviewInput : reviewInput?.reviews || [reviewInput];
  const drafts = loadEmailDrafts(root, config);
  const updates = [];
  const stored = [];

  for (const review of reviews) {
    validateReviewShape(review);
    const record = [...drafts.values()].find((item) => item.id === review.email_draft_id);
    if (!record) throw new Error(`unknown_email_draft:${review.email_draft_id}`);
    const request = buildDraftRequest(root, config, record);
    if (request.status === 'blocked') {
      throw new Error(`draft_not_reviewable:${review.email_draft_id}:${request.blockers.join('|')}`);
    }
    if (review.source_hash !== request.source_hash) {
      throw new Error(`stale_codex_review:${review.email_draft_id}`);
    }

    const normalized = {
      ...review,
      recommendations: asArray(review.recommendations),
      unsupported_claims: asArray(review.unsupported_claims),
      reviewed_at: review.reviewed_at || new Date().toISOString(),
    };
    const file = reviewFile(root, config, review.email_draft_id);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
    updates.push({
      ...record,
      status: normalized.decision === 'block' ? 'blocked_codex_review' : 'codex_reviewed',
      content_hash: request.source_hash,
      attachment_hash: request.attachment_sha256,
      codex_review_file: relativePath(root, file),
      quality_gate_status: normalized.decision === 'block' ? 'blocked_by_codex' : 'passed',
      notes: normalized.decision === 'block'
        ? 'Codex review blocked Gmail draft creation.'
        : 'Codex review passed; Gmail draft may be created automatically while the vacancy proof remains fresh.',
      updated_at: todayISO(),
    });
    stored.push({ email_draft_id: review.email_draft_id, file: relativePath(root, file) });
  }

  upsertEmailDrafts(root, updates, config);
  return { stored };
}

export function recordGmailDraftResults(resultInput, options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadEmailConfig(root);
  assertAdapterPolicy(config);
  const results = Array.isArray(resultInput) ? resultInput : resultInput?.results || [resultInput];
  const drafts = loadEmailDrafts(root, config);
  const updates = [];

  for (const result of results) {
    if (!result?.email_draft_id || !result?.source_hash || !result?.gmail_draft_id) {
      throw new Error('invalid_gmail_draft_result');
    }
    const record = [...drafts.values()].find((item) => item.id === result.email_draft_id);
    if (!record) throw new Error(`unknown_email_draft:${result.email_draft_id}`);
    const ready = readyGmailDraftRequests({ projectRoot: root, id: record.application_id });
    const request = ready.requests.find((item) => item.email_draft_id === result.email_draft_id);
    if (!request || request.status !== 'ready') {
      throw new Error(`gmail_draft_result_not_ready:${result.email_draft_id}`);
    }
    if (request.source_hash !== result.source_hash) {
      throw new Error(`gmail_draft_result_hash_mismatch:${result.email_draft_id}`);
    }
    if (record.gmail_draft_id && record.gmail_draft_id !== result.gmail_draft_id) {
      throw new Error(`gmail_draft_already_recorded:${result.email_draft_id}`);
    }
    updates.push({
      ...record,
      status: 'gmail_draft_created',
      gmail_draft_id: result.gmail_draft_id,
      gmail_message_id: result.gmail_message_id || record.gmail_message_id || '',
      gmail_thread_id: result.gmail_thread_id || record.gmail_thread_id || '',
      content_hash: request.source_hash,
      attachment_hash: request.attachment_sha256,
      last_gmail_sync: result.created_at || new Date().toISOString(),
      quality_gate_status: 'passed',
      notes: 'Unsent Gmail draft created automatically. Human review is required before sending.',
      updated_at: todayISO(),
    });
  }

  upsertEmailDrafts(root, updates, config);
  return { recorded: updates.map((item) => item.id) };
}

function buildDraftRequest(root, config, record) {
  const blockers = [];
  const application = loadApplications(root).find((item) =>
    String(item.id) === String(record.application_id)
    || item.report_number === record.report_number);
  const localDraftFile = record.body_file ? resolve(root, record.body_file) : '';
  const attachmentFile = record.planned_attachment ? resolve(root, record.planned_attachment) : '';
  const hasLocalDraft = isFile(localDraftFile);
  const hasAttachment = isFile(attachmentFile);
  const body = hasLocalDraft ? extractSection(readFileSync(localDraftFile, 'utf-8'), 'Body') : '';
  const subject = clean(record.subject);
  const recipient = clean(record.to);
  const verification = verifyFreshVacancy(application, config);
  const packFile = findApplicationPack(root, record.application_id);
  const quality = packFile
    ? runDraftQualityGate({ projectRoot: root, files: [packFile] })
    : { ok: false, totals: { errors: 1, warnings: 0 }, results: [] };

  if (!application) blockers.push('missing_application');
  if (!['local_ready', 'codex_reviewed', 'blocked_codex_review'].includes(record.status)) {
    blockers.push(`draft_status_${record.status || 'missing'}`);
  }
  if (!hasLocalDraft) blockers.push('missing_local_draft');
  if (!isConfirmedEmail(recipient)) blockers.push('unconfirmed_recipient');
  if (!body || normalize(body) === 'a confirmar') blockers.push('missing_body');
  if (!subject || normalize(subject) === 'a confirmar') blockers.push('missing_subject');
  if (!hasAttachment) blockers.push('missing_attachment');
  if (hasAttachment && extname(attachmentFile).toLowerCase() !== '.pdf') blockers.push('attachment_not_pdf');
  if (!verification.ok) blockers.push(`vacancy_${verification.reason}`);
  if (config.safety?.require_application_pack && !packFile) blockers.push('missing_application_pack');
  if (config.safety?.require_draft_quality_gate && !quality.ok) blockers.push('draft_quality_failed');

  const attachmentSha256 = hasAttachment ? sha256(readFileSync(attachmentFile)) : '';
  const sourceHash = sha256(JSON.stringify({
    recipient,
    subject,
    body,
    attachment_sha256: attachmentSha256,
    vacancy_verified_at: verification.timestamp || '',
  }));
  const request = {
    schema_version: 1,
    action: 'gmail.create_draft',
    email_draft_id: record.id,
    application_id: record.application_id,
    report_number: record.report_number,
    company: record.company,
    role: record.role,
    status: blockers.length ? 'blocked' : 'needs_codex_review',
    blockers,
    to: recipient,
    subject,
    body,
    content_type: 'text/plain',
    attachment_files: hasAttachment ? [attachmentFile] : [],
    attachment_sha256: attachmentSha256,
    source_hash: sourceHash,
    vacancy_verification: verification,
    evidence_files: [
      application?.report_path ? resolve(root, application.report_path) : '',
      resolve(root, 'data', 'candidate-evidence.md'),
      packFile || '',
    ].filter(Boolean),
    connector_rule: 'Create an unsent Gmail draft only. Never call send_draft.',
  };
  request.record_update = {
    ...record,
    content_hash: sourceHash,
    attachment_hash: attachmentSha256,
  };
  return request;
}

function applyCodexReview(root, config, request) {
  const file = reviewFile(root, config, request.email_draft_id);
  if (!existsSync(file)) {
    return { ...request, status: 'needs_codex_review', review_file: relativePath(root, file) };
  }
  let review;
  try {
    review = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { ...request, status: 'blocked', blockers: [...request.blockers, 'invalid_codex_review_json'] };
  }
  try {
    validateReviewShape(review);
  } catch (error) {
    return { ...request, status: 'blocked', blockers: [...request.blockers, error.message] };
  }
  if (review.source_hash !== request.source_hash) {
    return { ...request, status: 'blocked', blockers: [...request.blockers, 'stale_codex_review'] };
  }
  if (review.decision === 'block' || review.gmail_draft_allowed !== true) {
    return { ...request, status: 'blocked', blockers: [...request.blockers, 'codex_review_blocked'], review };
  }
  if (asArray(review.unsupported_claims).length > 0) {
    return { ...request, status: 'blocked', blockers: [...request.blockers, 'unsupported_claims'], review };
  }
  const subject = review.decision === 'revise' ? clean(review.revised_subject) : request.subject;
  const body = review.decision === 'revise' ? cleanMultiline(review.revised_body) : request.body;
  const revisedBlockers = [];
  if (!subject || normalize(subject) === 'a confirmar') revisedBlockers.push('invalid_reviewed_subject');
  if (!body || normalize(body) === 'a confirmar') revisedBlockers.push('invalid_reviewed_body');
  if (/\b(?:warvis|wairvis)\b/i.test(`${subject}\n${body}`)) revisedBlockers.push('legacy_private_project_name');
  return {
    ...request,
    status: revisedBlockers.length ? 'blocked' : 'ready',
    blockers: revisedBlockers,
    subject,
    body,
    review,
    review_file: relativePath(root, file),
  };
}

function assertAdapterPolicy(config) {
  assertEmailPolicy(config);
  if (config.enabled !== true) throw new Error('gmail_adapter_disabled');
  if (config.mode !== 'draft_only') throw new Error('gmail_adapter_requires_draft_only_mode');
  if (config.allow_real_gmail_drafts !== true) throw new Error('real_gmail_drafts_not_allowed');
  if (config.auto_send !== false) throw new Error('auto_send_must_be_false');
  if (config.safety?.never_send_without_approval !== true) throw new Error('send_approval_guard_missing');
}

function selectDrafts(root, config, options) {
  const drafts = [...loadEmailDrafts(root, config).values()];
  const wanted = options.id
    ? new Set(String(options.id).split(',').map((item) => item.trim()).filter(Boolean))
    : null;
  return drafts.filter((record) => !wanted
    || wanted.has(record.application_id)
    || wanted.has(record.report_number)
    || wanted.has(record.id));
}

function validateReviewShape(review) {
  if (!review?.email_draft_id || !review?.source_hash) throw new Error('invalid_codex_review_identity');
  if (!ALLOWED_REVIEW_DECISIONS.has(review.decision)) throw new Error('invalid_codex_review_decision');
  if (review.decision === 'revise' && (!clean(review.revised_subject) || !cleanMultiline(review.revised_body))) {
    throw new Error('codex_revision_missing_copy');
  }
}

function verifyFreshVacancy(application, config) {
  if (!application) return { ok: false, reason: 'missing_application', timestamp: '' };
  const notes = String(application.notes || '');
  const timestamp = notes.match(/\[live-verified:([^\]]+)\]/i)?.[1] || '';
  const method = normalize(notes.match(/\[live-method:([^\]]+)\]/i)?.[1] || '');
  const state = normalize(notes.match(/\[live-state:([^\]]+)\]/i)?.[1] || '');
  if (!timestamp) return { ok: false, reason: 'missing_verification', timestamp: '' };
  if (method !== normalize(config.safety?.live_verification_method || 'playwright')) {
    return { ok: false, reason: 'wrong_verification_method', timestamp, method, state };
  }
  if (state !== 'active') return { ok: false, reason: `state_${state || 'missing'}`, timestamp, method, state };
  const verifiedAt = new Date(timestamp);
  const ageMinutes = Math.floor((Date.now() - verifiedAt.getTime()) / 60000);
  const maxAge = Number(config.safety?.live_verification_max_age_minutes ?? 15);
  if (!Number.isFinite(verifiedAt.getTime()) || ageMinutes < -5) {
    return { ok: false, reason: 'invalid_timestamp', timestamp, method, state };
  }
  if (ageMinutes > maxAge) return { ok: false, reason: `stale_${ageMinutes}m`, timestamp, method, state };
  return { ok: true, reason: 'active', timestamp, method, state, age_minutes: Math.max(0, ageMinutes) };
}

function findApplicationPack(root, applicationId) {
  const directory = resolve(root, 'output', 'application-packs');
  if (!existsSync(directory)) return '';
  const prefix = String(applicationId || '').padStart(3, '0');
  const name = readdirSync(directory)
    .filter((item) => item.toLowerCase().endsWith('.md'))
    .find((item) => item.startsWith(`${prefix}-`) || item === `${prefix}.md`);
  return name ? join(directory, name) : '';
}

function extractSection(markdown, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'mi');
  const match = pattern.exec(String(markdown || ''));
  if (!match) return '';
  const rest = String(markdown).slice(match.index + match[0].length);
  const next = rest.search(/^##\s+/m);
  return cleanMultiline(next >= 0 ? rest.slice(0, next) : rest);
}

function requestFile(root, config, draftId) {
  return resolve(root, config.adapter?.requests_dir || 'output/gmail-adapter/draft-requests', `${draftId}.json`);
}

function reviewFile(root, config, draftId) {
  return resolve(root, config.adapter?.reviews_dir || 'output/gmail-adapter/reviews', `${draftId}.json`);
}

function summarizeRequests(requests, dryRun) {
  const counts = {};
  for (const request of requests) counts[request.status] = (counts[request.status] || 0) + 1;
  return {
    dry_run: Boolean(dryRun),
    total: requests.length,
    counts,
    requests: requests.map(({ record_update, ...request }) => request),
  };
}

function isConfirmedEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function isFile(file) {
  if (!file || !existsSync(file)) return false;
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function relativePath(root, file) {
  return String(file || '').replace(`${root}\\`, '').replace(`${root}/`, '').replace(/\\/g, '/');
}

function clean(value) {
  return String(value || '').replace(/\r?\n/g, ' ').trim();
}

function cleanMultiline(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const options = { command: argv[0] || 'prepare', dryRun: false, json: false, id: '', file: '' };
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--id') options.id = argv[++index] || '';
    else if (arg === '--file') options.file = argv[++index] || '';
    else if (arg === '--root') options.projectRoot = resolve(argv[++index] || projectRoot);
  }
  return options;
}

function readJsonInput(file) {
  if (!file) throw new Error('missing_--file');
  return JSON.parse(readFileSync(resolve(file), 'utf-8'));
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.requests) {
    console.log(`Gmail adapter: ${result.total} request(s).`);
    for (const [status, count] of Object.entries(result.counts)) console.log(`- ${status}: ${count}`);
    for (const request of result.requests.filter((item) => item.status === 'blocked')) {
      console.log(`  ${request.email_draft_id}: ${request.blockers.join(', ')}`);
    }
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  try {
    let result;
    if (options.command === 'prepare') result = prepareGmailDraftRequests(options);
    else if (options.command === 'ready') result = readyGmailDraftRequests(options);
    else if (options.command === 'record-review') result = recordCodexReviews(readJsonInput(options.file), options);
    else if (options.command === 'record-draft') result = recordGmailDraftResults(readJsonInput(options.file), options);
    else throw new Error(`unknown_command:${options.command}`);
    printResult(result, options.json);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
