import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { todayISO } from '../job-normalizer.mjs';

export const EMAIL_DRAFTS_HEADER = 'id\tapplication_id\treport_number\tcompany\trole\tstatus\tprovider\tto\tsubject\tbody_file\tplanned_attachment\tgmail_draft_id\tcreated_at\tupdated_at\treview_required\tquality_gate_status\tnotes';

export function emailDraftsPath(root, config = {}) {
  return resolve(root, config.drafts?.store || 'data/email-drafts.tsv');
}

export function loadEmailDrafts(root, config = {}) {
  const file = emailDraftsPath(root, config);
  const records = new Map();
  if (!existsSync(file)) return records;

  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    const fields = line.split('\t');
    while (fields.length < 17) fields.push('');
    const record = {
      id: fields[0],
      application_id: fields[1],
      report_number: fields[2],
      company: fields[3],
      role: fields[4],
      status: fields[5],
      provider: fields[6],
      to: fields[7],
      subject: fields[8],
      body_file: fields[9],
      planned_attachment: fields[10],
      gmail_draft_id: fields[11],
      created_at: fields[12],
      updated_at: fields[13],
      review_required: fields[14],
      quality_gate_status: fields[15],
      notes: fields[16],
    };
    records.set(record.report_number || record.application_id || record.id, record);
  }
  return records;
}

export function upsertEmailDrafts(root, incomingRecords, config = {}) {
  const existing = loadEmailDrafts(root, config);
  for (const incoming of incomingRecords) {
    const key = incoming.report_number || incoming.application_id || incoming.id;
    const current = existing.get(key);
    existing.set(key, mergeDraftRecord(current, incoming, existing));
  }
  writeEmailDrafts(root, existing, config);
  return existing;
}

export function writeEmailDrafts(root, records, config = {}) {
  const file = emailDraftsPath(root, config);
  mkdirSync(dirname(file), { recursive: true });
  const rows = [...records.values()]
    .sort((a, b) => draftSortKey(a) - draftSortKey(b))
    .map((record) => [
      record.id,
      record.application_id,
      record.report_number,
      record.company,
      record.role,
      record.status,
      record.provider,
      record.to,
      record.subject,
      record.body_file,
      record.planned_attachment,
      record.gmail_draft_id,
      record.created_at,
      record.updated_at,
      record.review_required,
      record.quality_gate_status,
      record.notes,
    ].map(tsvCell).join('\t'));

  writeFileSync(file, `${EMAIL_DRAFTS_HEADER}\n${rows.join('\n')}${rows.length ? '\n' : ''}`, 'utf-8');
}

export function nextEmailDraftId(records) {
  let max = 0;
  for (const record of records.values()) {
    const number = Number(String(record.id || '').replace(/^ED-/, ''));
    if (Number.isFinite(number) && number > max) max = number;
  }
  return `ED-${String(max + 1).padStart(4, '0')}`;
}

function mergeDraftRecord(current, incoming, allRecords) {
  const now = todayISO();
  if (!current) {
    return {
      gmail_draft_id: '',
      ...incoming,
      id: incoming.id || nextEmailDraftId(allRecords),
      created_at: incoming.created_at || now,
      updated_at: incoming.updated_at || now,
    };
  }

  const lockedStatus = ['gmail_draft_created', 'sent_manually', 'closed'].includes(current.status);
  const id = current.id || incoming.id || nextEmailDraftId(allRecords);
  return {
    ...current,
    ...incoming,
    id,
    created_at: current.created_at || incoming.created_at || now,
    gmail_draft_id: current.gmail_draft_id || incoming.gmail_draft_id || '',
    status: lockedStatus ? current.status : incoming.status,
    updated_at: incoming.updated_at || now,
  };
}

function draftSortKey(record) {
  return Number(record.application_id || String(record.report_number || '').replace(/^0+/, '')) || 0;
}

function tsvCell(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}
