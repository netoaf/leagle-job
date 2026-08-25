#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  loadApplications,
  updateApplicationStatus,
} from './lib/applications-store.mjs';
import {
  loadEmailConfig,
  assertEmailPolicy,
} from './lib/email/email-policy.mjs';
import {
  loadEmailDrafts,
  nextEmailDraftId,
  upsertEmailDrafts,
} from './lib/email/email-draft-store.mjs';
import {
  loadFollowups,
  writeFollowups,
} from './follow-up-tracker.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const EVENTS_HEADER = [
  'event_id',
  'email_draft_id',
  'application_id',
  'type',
  'classification',
  'message_id',
  'thread_id',
  'from',
  'to',
  'subject',
  'occurred_at',
  'imported_at',
  'snippet',
].join('\t');
const EVENT_TYPES = new Set(['sent', 'reply', 'automated_reply']);

export function buildGmailSyncPlan(options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadEmailConfig(root);
  assertSyncPolicy(config);
  const days = Number(config.sync?.newer_than_days || 30);
  const allDrafts = [...loadEmailDrafts(root, config).values()];
  const drafts = allDrafts
    .filter((record) => ['gmail_draft_created', 'sent_manually', 'responded'].includes(record.status))
    .filter((record) => !options.id
      || [record.id, record.application_id, record.report_number].includes(String(options.id)));
  const searches = drafts.map((record) => ({
    email_draft_id: record.id,
    application_id: record.application_id,
    company: record.company,
    role: record.role,
    known_thread_id: record.gmail_thread_id || '',
    sent_query: `in:sent newer_than:${days}d to:${record.to} subject:"${gmailQueryText(record.subject)}"`,
    reply_query: `newer_than:${days}d -in:sent -from:me subject:"${gmailQueryText(record.subject)}"`,
    matching_rule: 'Prefer exact Gmail thread_id; otherwise require matching normalized subject and a participant address.',
  }));

  const representedApplicationIDs = new Set(allDrafts.map((record) => String(record.application_id || '')));
  const orphanScheduled = loadApplications(root)
    .filter((application) => String(application.status).toLowerCase() === 'scheduled')
    .filter((application) => !representedApplicationIDs.has(String(application.id)))
    .filter((application) => !options.id || [String(application.id), application.report_number].includes(String(options.id)));

  for (const application of orphanScheduled) {
    const recipient = extractEmailAddress(application.notes);
    searches.push({
      email_draft_id: '',
      application_id: String(application.id),
      company: application.company,
      role: application.role,
      known_thread_id: '',
      sent_query: recipient ? `in:sent newer_than:${days}d to:${recipient}` : '',
      reply_query: '',
      expected_subject_hint: application.role,
      recovery_reason: 'scheduled_application_missing_email_draft_record',
      matching_rule: 'Fail closed: require one unique sent message, exact participant match and normalized role/company evidence in the subject. Import by application_id only after reading the candidate thread.',
    });
  }
  return {
    schema_version: 1,
    read_only: true,
    searches,
    import_schema: {
      events: [{
        email_draft_id: 'ED-0001',
        type: 'sent|reply|automated_reply',
        classification: 'sent|human_reply|interview_invite|request_information|rejection|automated_ack',
        message_id: 'gmail message id',
        thread_id: 'gmail thread id',
        from: 'sender',
        to: 'recipient',
        subject: 'subject',
        occurred_at: 'ISO timestamp',
        snippet: 'short factual summary',
      }],
    },
  };
}

function extractEmailAddress(value) {
  return String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
}

export function importGmailEvents(input, options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadEmailConfig(root);
  assertSyncPolicy(config);
  const events = Array.isArray(input) ? input : input?.events || [input];
  const drafts = loadEmailDrafts(root, config);
  const followups = loadFollowups(root);
  const existingEvents = loadEvents(root);
  const draftUpdates = [];
  const imported = [];

  for (const rawEvent of events) {
    const event = normalizeEvent(rawEvent);
    validateEvent(event);
    if (existingEvents.has(event.event_id)) continue;
    let record = event.email_draft_id
      ? [...drafts.values()].find((item) => item.id === event.email_draft_id)
      : null;
    if (!record && event.application_id) {
      record = [...drafts.values()].find((item) =>
        String(item.application_id) === String(event.application_id));
    }
    const application = loadApplications(root).find((item) =>
      (event.application_id && String(item.id) === String(event.application_id))
      || (record && (String(item.id) === String(record.application_id)
        || item.report_number === record.report_number)));
    if (!application) throw new Error(`unknown_application_for_event:${event.event_id}`);
    if (!record) {
      if (event.type !== 'sent') throw new Error(`reply_without_known_application_thread:${event.event_id}`);
      record = legacySentDraftRecord(drafts, application, event);
      drafts.set(application.report_number, record);
    }
    if (!eventMatchesDraft(event, record)) throw new Error(`gmail_event_mismatch:${event.event_id}`);

    const date = event.occurred_at.slice(0, 10);
    const followup = followups.get(record.report_number) || newFollowup(application);
    if (event.type === 'sent') {
      const suppressFollowup = shouldSuppressFollowup(application, followup);
      draftUpdates.push({
        ...record,
        status: 'sent_manually',
        gmail_message_id: event.message_id,
        gmail_thread_id: event.thread_id,
        last_gmail_sync: event.occurred_at,
        notes: 'Send detected in Gmail. Application status and follow-up were synchronized automatically.',
        updated_at: todayISO(),
      });
      followups.set(record.report_number, {
        ...followup,
        applied_at: followup.applied_at || date,
        last_contact: date,
        followup_due: suppressFollowup
          ? ''
          : addDays(date, Number(config.followups?.no_response_after_days || 7)),
        contact_channel: 'email',
        contact_name: record.to,
        next_action: suppressFollowup
          ? 'Sem follow-up: vaga indisponível.'
          : 'Aguardar resposta; se não houver resposta até à data, rever o rascunho de follow-up automático.',
        gmail_thread_id: event.thread_id,
        last_message_id: event.message_id,
        response_state: suppressFollowup ? 'closed_no_followup' : 'waiting_for_reply',
        recommendation: suppressFollowup
          ? 'Não fazer follow-up: a vaga foi confirmada como indisponível após o envio.'
          : 'Nenhuma ação imediata. O Leagle Job volta a verificar a conversa e prepara follow-up quando vencer.',
        notes: appendNote(followup.notes, 'Envio confirmado automaticamente no Gmail Sent.'),
        updated_at: todayISO(),
        synced_at: new Date().toISOString(),
      });
      if (config.sync?.update_application_status) {
        updateApplicationStatus(root, application.id, 'Applied', '[gmail-sent-detected]');
      }
    } else if (event.type === 'reply') {
      const advice = responseAdvice(event.classification, Boolean(followup.followup_draft_id));
      draftUpdates.push({
        ...record,
        status: 'responded',
        gmail_message_id: record.gmail_message_id || '',
        gmail_thread_id: event.thread_id,
        last_gmail_sync: event.occurred_at,
        notes: `Reply detected in Gmail: ${event.classification}. Review before taking the recommended next step.`,
        updated_at: todayISO(),
      });
      followups.set(record.report_number, {
        ...followup,
        last_contact: date,
        followup_due: advice.followup_due_days === null ? '' : addDays(date, advice.followup_due_days),
        contact_channel: 'email',
        contact_name: event.from || record.to,
        next_action: advice.next_action,
        gmail_thread_id: event.thread_id,
        last_message_id: event.message_id,
        response_state: event.classification,
        recommendation: advice.recommendation,
        notes: appendNote(followup.notes, `Resposta Gmail detetada: ${event.classification}.`),
        updated_at: todayISO(),
        synced_at: new Date().toISOString(),
      });
      if (config.sync?.update_application_status) {
        updateApplicationStatus(root, application.id, 'Responded', '[gmail-reply-detected]');
      }
    } else {
      followups.set(record.report_number, {
        ...followup,
        last_contact: date,
        gmail_thread_id: event.thread_id,
        last_message_id: followup.last_message_id || event.message_id,
        response_state: 'automated_ack',
        recommendation: 'Confirmação automática recebida; não conta como resposta humana. Mantém o follow-up atual.',
        notes: appendNote(followup.notes, 'Confirmação automática do Gmail detetada.'),
        updated_at: todayISO(),
        synced_at: new Date().toISOString(),
      });
    }

    existingEvents.set(event.event_id, event);
    imported.push(event.event_id);
  }

  if (draftUpdates.length) upsertEmailDrafts(root, draftUpdates, config);
  writeFollowups(root, followups);
  writeEvents(root, existingEvents);
  return { imported, skipped_duplicates: events.length - imported.length };
}

export function buildAutomaticFollowupPlan(options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadEmailConfig(root);
  assertSyncPolicy(config);
  if (config.followups?.enabled !== true || config.followups?.auto_create_drafts !== true) {
    throw new Error('automatic_followup_drafts_disabled');
  }
  const applications = loadApplications(root);
  const drafts = [...loadEmailDrafts(root, config).values()];
  const followups = [...loadFollowups(root).values()];
  const signatureName = clean(config.followups?.signature_name || '');
  const requests = [];

  for (const followup of followups) {
    if (!followup.followup_due || followup.followup_due > todayISO()) continue;
    if (followup.followup_draft_id) continue;
    if (['human_reply', 'interview_invite', 'request_information', 'rejection', 'closed_no_followup'].includes(followup.response_state)) continue;
    const application = applications.find((item) => item.report_number === followup.report_number);
    if (!application || normalize(application.status) !== 'applied') continue;
    const draft = drafts.find((item) => item.report_number === followup.report_number);
    if (!draft?.gmail_message_id || !isConfirmedEmail(draft.to)) continue;
    if (options.id && ![draft.id, draft.application_id, draft.report_number].includes(String(options.id))) continue;

    const language = inferFollowupLanguage(draft);
    const body = followupBody(language, application, followup, signatureName);
    const request = {
      schema_version: 1,
      action: 'gmail.create_draft',
      kind: 'followup',
      followup_id: `FU-${draft.report_number}`,
      email_draft_id: draft.id,
      application_id: draft.application_id,
      company: draft.company,
      role: draft.role,
      to: draft.to,
      subject: /^re:/i.test(draft.subject) ? draft.subject : `Re: ${draft.subject}`,
      body,
      content_type: 'text/plain',
      reply_message_id: followup.last_message_id || draft.gmail_message_id,
      source_hash: sha256(JSON.stringify({
        to: draft.to,
        subject: draft.subject,
        body,
        reply_message_id: followup.last_message_id || draft.gmail_message_id,
      })),
      codex_review_required: true,
      connector_rule: 'Create an unsent threaded Gmail draft only. Never call send_draft.',
    };
    requests.push(request);
  }

  return { schema_version: 1, requests };
}

export function recordAutomaticFollowupDrafts(input, options = {}) {
  const root = options.projectRoot || projectRoot;
  const config = loadEmailConfig(root);
  assertSyncPolicy(config);
  const results = Array.isArray(input) ? input : input?.results || [input];
  const plans = buildAutomaticFollowupPlan({ projectRoot: root }).requests;
  const followups = loadFollowups(root);
  const recorded = [];

  for (const result of results) {
    const plan = plans.find((item) => item.followup_id === result.followup_id);
    if (!plan) throw new Error(`unknown_or_not_due_followup:${result.followup_id}`);
    if (plan.source_hash !== result.source_hash) throw new Error(`stale_followup_result:${result.followup_id}`);
    if (!result.gmail_draft_id) throw new Error(`missing_followup_gmail_draft_id:${result.followup_id}`);
    validateFollowupReview(result.codex_review, plan);
    const reportNumber = result.followup_id.replace(/^FU-/, '');
    const record = followups.get(reportNumber);
    followups.set(reportNumber, {
      ...record,
      followup_draft_id: result.gmail_draft_id,
      next_action: 'Rever o rascunho de follow-up no Gmail e enviar manualmente apenas se continuar adequado.',
      recommendation: 'Rascunho de follow-up criado automaticamente; nenhum email foi enviado.',
      updated_at: todayISO(),
      synced_at: new Date().toISOString(),
    });
    recorded.push(result.followup_id);
  }

  writeFollowups(root, followups);
  return { recorded };
}

function assertSyncPolicy(config) {
  assertEmailPolicy(config);
  if (config.enabled !== true) throw new Error('gmail_integration_disabled');
  if (config.sync?.read_replies !== true) throw new Error('gmail_reply_sync_disabled');
  if (config.auto_send !== false) throw new Error('auto_send_must_be_false');
}

function normalizeEvent(event) {
  const occurredAt = normalizeTimestamp(event?.occurred_at);
  return {
    event_id: event?.event_id || event?.message_id || '',
    email_draft_id: event?.email_draft_id || '',
    application_id: event?.application_id || '',
    type: normalize(event?.type),
    classification: normalize(event?.classification || defaultClassification(event?.type)),
    message_id: event?.message_id || '',
    thread_id: event?.thread_id || '',
    from: clean(event?.from),
    to: clean(event?.to),
    subject: clean(event?.subject),
    occurred_at: occurredAt,
    imported_at: new Date().toISOString(),
    snippet: clean(event?.snippet),
  };
}

function validateEvent(event) {
  if (!event.event_id || (!event.email_draft_id && !event.application_id) || !event.message_id || !event.thread_id) {
    throw new Error('gmail_event_missing_identity');
  }
  if (!EVENT_TYPES.has(event.type)) throw new Error(`unsupported_gmail_event_type:${event.type}`);
  if (!event.occurred_at) throw new Error(`invalid_gmail_event_timestamp:${event.event_id}`);
}

function eventMatchesDraft(event, draft) {
  if (draft.gmail_thread_id && event.thread_id === draft.gmail_thread_id) return true;
  const subjectMatches = normalizeSubject(event.subject) === normalizeSubject(draft.subject);
  const participant = `${event.from} ${event.to}`.toLowerCase();
  const emailMatches = draft.to && participant.includes(String(draft.to).toLowerCase());
  return subjectMatches && emailMatches;
}

function legacySentDraftRecord(drafts, application, event) {
  return {
    id: nextEmailDraftId(drafts),
    application_id: String(application.id),
    report_number: application.report_number,
    company: application.company,
    role: application.role,
    status: 'sent_manually',
    provider: 'gmail',
    to: firstEmail(event.to),
    subject: event.subject,
    body_file: '',
    planned_attachment: '',
    gmail_draft_id: '',
    gmail_message_id: event.message_id,
    gmail_thread_id: event.thread_id,
    created_at: event.occurred_at.slice(0, 10),
    updated_at: todayISO(),
    review_required: 'yes',
    quality_gate_status: 'legacy_manual_send',
    notes: 'Historical manual send imported from Gmail; no claim that Leagle Job created or reviewed it.',
    content_hash: '',
    attachment_hash: '',
    codex_review_file: '',
    last_gmail_sync: event.occurred_at,
  };
}

function validateFollowupReview(review, plan) {
  if (!review || review.source_hash !== plan.source_hash) throw new Error('missing_or_stale_followup_codex_review');
  if (!['ready_for_gmail_draft', 'revise'].includes(review.decision)) throw new Error('followup_codex_review_blocked');
  if (review.gmail_draft_allowed !== true) throw new Error('followup_gmail_draft_not_allowed');
  if (Array.isArray(review.unsupported_claims) && review.unsupported_claims.length) {
    throw new Error('followup_review_contains_unsupported_claims');
  }
}

function responseAdvice(classification, hasPendingFollowupDraft) {
  const pending = hasPendingFollowupDraft
    ? ' Existe um follow-up por enviar: não o envies; revê ou elimina-o manualmente.'
    : '';
  if (classification === 'interview_invite') {
    return {
      followup_due_days: 1,
      next_action: 'Rever horários e requisitos; preparar resposta de disponibilidade e entrevista.',
      recommendation: `Prioridade alta: responde manualmente dentro de 24 horas e prepara a entrevista.${pending}`,
    };
  }
  if (classification === 'request_information') {
    return {
      followup_due_days: 1,
      next_action: 'Reunir apenas informação confirmada e preparar uma resposta curta.',
      recommendation: `Responde manualmente dentro de 24 horas; não inventes dados em falta.${pending}`,
    };
  }
  if (classification === 'rejection') {
    return {
      followup_due_days: null,
      next_action: 'Confirmar que é uma rejeição explícita; depois marcar Rejected e arquivar.',
      recommendation: `Não é necessário follow-up, salvo agradecimento curto se houver contacto humano útil.${pending}`,
    };
  }
  return {
    followup_due_days: 2,
    next_action: 'Ler a resposta completa e preparar a próxima resposta ou ação.',
    recommendation: `Revê o conteúdo e responde manualmente em até 2 dias úteis.${pending}`,
  };
}

function shouldSuppressFollowup(application, followup) {
  const text = normalize(`${application?.notes || ''} ${followup?.next_action || ''} ${followup?.notes || ''}`);
  return text.includes('live-state:closed')
    || text.includes('nao fazer follow-up')
    || text.includes('não fazer follow-up')
    || text.includes('sem follow-up')
    || text.includes('vaga indisponivel')
    || text.includes('vaga indisponível');
}

function newFollowup(application) {
  return {
    id: String(application.id),
    report_number: application.report_number,
    company: application.company,
    role: application.role,
    applied_at: '',
    last_contact: '',
    followup_due: '',
    contact_channel: '',
    contact_name: '',
    next_action: '',
    notes: '',
    updated_at: todayISO(),
    gmail_thread_id: '',
    last_message_id: '',
    followup_draft_id: '',
    response_state: '',
    recommendation: '',
    synced_at: '',
  };
}

function followupBody(language, application, followup, signatureName = '') {
  const signature = clean(signatureName);
  if (language === 'en') {
    return `Hello,\n\nI am following up on my application for the ${application.role} position, sent on ${followup.applied_at || 'the date shown in this thread'}. I remain interested in the opportunity and available to provide any additional information.\n\nKind regards,${signature ? `\n${signature}` : ''}`;
  }
  return `Bom dia,\n\nGostaria de acompanhar a minha candidatura à posição de ${application.role}, enviada em ${followup.applied_at || 'data indicada nesta conversa'}. Continuo interessado na oportunidade e disponível para fornecer qualquer informação adicional.\n\nCumprimentos,${signature ? `\n${signature}` : ''}`;
}

function inferFollowupLanguage(draft) {
  const text = normalize(`${draft.subject} ${draft.body_file}`);
  return /\b(application|internship|developer|engineer)\b/.test(text) && !/\b(candidatura|estagio|programador)\b/.test(text)
    ? 'en'
    : 'pt';
}

function loadEvents(root) {
  const file = eventsFile(root);
  const events = new Map();
  if (!existsSync(file)) return events;
  for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('event_id\t')) continue;
    const fields = line.split('\t');
    while (fields.length < 13) fields.push('');
    events.set(fields[0], {
      event_id: fields[0],
      email_draft_id: fields[1],
      application_id: fields[2],
      type: fields[3],
      classification: fields[4],
      message_id: fields[5],
      thread_id: fields[6],
      from: fields[7],
      to: fields[8],
      subject: fields[9],
      occurred_at: fields[10],
      imported_at: fields[11],
      snippet: fields[12],
    });
  }
  return events;
}

function writeEvents(root, events) {
  const file = eventsFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const rows = [...events.values()]
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .map((event) => [
      event.event_id,
      event.email_draft_id,
      event.application_id,
      event.type,
      event.classification,
      event.message_id,
      event.thread_id,
      event.from,
      event.to,
      event.subject,
      event.occurred_at,
      event.imported_at,
      event.snippet,
    ].map(tsvCell).join('\t'));
  writeFileSync(file, `${EVENTS_HEADER}\n${rows.join('\n')}${rows.length ? '\n' : ''}`, 'utf-8');
}

function eventsFile(root) {
  return join(root, 'data', 'gmail-events.tsv');
}

function appendNote(current, note) {
  if (!note || String(current || '').includes(note)) return current || '';
  return [current, note].filter(Boolean).join(' ');
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return value.toISOString().slice(0, 10);
}

function normalizeTimestamp(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function defaultClassification(type) {
  return normalize(type) === 'sent' ? 'sent' : 'human_reply';
}

function normalizeSubject(value) {
  return normalize(value).replace(/^(re|fw|fwd):\s*/g, '');
}

function gmailQueryText(value) {
  return clean(value).replace(/["\\]/g, ' ');
}

function isConfirmedEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function firstEmail(value) {
  const match = String(value || '').match(/[^\s<,]+@[^\s>,]+/);
  return match?.[0] || clean(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function clean(value) {
  return String(value || '').replace(/\r?\n/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function tsvCell(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const options = { command: argv[0] || 'plan', json: false, id: '', file: '' };
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  try {
    let result;
    if (options.command === 'plan') result = buildGmailSyncPlan(options);
    else if (options.command === 'import') result = importGmailEvents(readJsonInput(options.file), options);
    else if (options.command === 'followups') result = buildAutomaticFollowupPlan(options);
    else if (options.command === 'record-followup-draft') {
      result = recordAutomaticFollowupDrafts(readJsonInput(options.file), options);
    } else throw new Error(`unknown_command:${options.command}`);
    console.log(JSON.stringify(result, null, options.json ? 2 : 0));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
