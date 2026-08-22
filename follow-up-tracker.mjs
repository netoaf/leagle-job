#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { isClosedStatus, loadApplications } from './lib/applications-store.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
export const FOLLOWUPS_HEADER = [
  'id',
  'report_number',
  'company',
  'role',
  'applied_at',
  'last_contact',
  'followup_due',
  'contact_channel',
  'contact_name',
  'next_action',
  'notes',
  'updated_at',
  'gmail_thread_id',
  'last_message_id',
  'followup_draft_id',
  'response_state',
  'recommendation',
  'synced_at',
].join('\t');

export function runFollowupTracker(options = {}) {
  const root = options.projectRoot || projectRoot;
  const applications = loadApplications(root);
  const records = loadFollowups(root);

  if (options.init) {
    for (const app of applications) {
      const key = app.report_number || String(app.id);
      if (!key || records.has(key)) continue;
      if (isClosed(app.status)) continue;
      records.set(key, {
        id: String(app.id),
        report_number: app.report_number,
        company: app.company,
        role: app.role,
        applied_at: '',
        last_contact: '',
        followup_due: '',
        contact_channel: '',
        contact_name: '',
        next_action: defaultNextAction(app.status),
        notes: '',
        updated_at: todayISO(),
        gmail_thread_id: '',
        last_message_id: '',
        followup_draft_id: '',
        response_state: '',
        recommendation: '',
        synced_at: '',
      });
    }
    writeFollowups(root, records);
  }

  const joined = applications.map((app) => {
    const key = app.report_number || String(app.id);
    const record = records.get(key) || {};
    return {
      ...app,
      ...record,
      next_action: record.next_action || defaultNextAction(app.status),
    };
  });

  const due = joined.filter((item) => isDue(item.followup_due) && !isClosed(item.status));
  const open = joined.filter((item) => item.next_action && !isClosed(item.status));

  return {
    applications: joined.length,
    followup_records: records.size,
    due,
    open,
    wrote: options.init === true,
  };
}

export function loadFollowups(root) {
  const file = followupFile(root);
  const records = new Map();
  if (!existsSync(file)) return records;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    const fields = line.split('\t');
    while (fields.length < 18) fields.push('');
    const record = {
      id: fields[0],
      report_number: fields[1],
      company: fields[2],
      role: fields[3],
      applied_at: fields[4],
      last_contact: fields[5],
      followup_due: fields[6],
      contact_channel: fields[7],
      contact_name: fields[8],
      next_action: fields[9],
      notes: fields[10],
      updated_at: fields[11],
      gmail_thread_id: fields[12],
      last_message_id: fields[13],
      followup_draft_id: fields[14],
      response_state: fields[15],
      recommendation: fields[16],
      synced_at: fields[17],
    };
    records.set(record.report_number || record.id, record);
  }
  return records;
}

export function writeFollowups(root, records) {
  const file = followupFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const rows = [...records.values()]
    .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
    .map((record) => [
      record.id,
      record.report_number,
      record.company,
      record.role,
      record.applied_at,
      record.last_contact,
      record.followup_due,
      record.contact_channel,
      record.contact_name,
      record.next_action,
      record.notes,
      record.updated_at,
      record.gmail_thread_id,
      record.last_message_id,
      record.followup_draft_id,
      record.response_state,
      record.recommendation,
      record.synced_at,
    ].map(tsvCell).join('\t'));
  writeFileSync(file, `${FOLLOWUPS_HEADER}\n${rows.join('\n')}${rows.length ? '\n' : ''}`, 'utf-8');
}

function followupFile(root) {
  return join(root, 'data', 'application-followups.tsv');
}

function isClosed(status) {
  return isClosedStatus(status);
}

function isDue(value) {
  if (!value) return false;
  return value <= todayISO();
}

export function defaultNextAction(status) {
  const text = normalize(status);
  if (text.includes('applied')) return 'Follow up if there is no response by the due date.';
  if (text.includes('responded')) return 'Reply or clarify next step.';
  if (text.includes('interview')) return 'Prepare interview notes and confirm schedule.';
  if (text.includes('offer')) return 'Review offer details and prepare response.';
  if (isClosed(status)) return 'Closed - no follow-up.';
  return 'Review report, confirm red flags, then apply manually or skip.';
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function tsvCell(value) {
  return String(value || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}

function parseArgs(argv) {
  const options = { init: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--init') options.init = true;
    else if (arg === '--root') options.projectRoot = resolve(argv[++index] || projectRoot);
  }
  return options;
}

function printResult(result) {
  console.log(`Follow-ups: ${result.followup_records} records for ${result.applications} applications.`);
  if (result.wrote) console.log('Initialized missing non-closed follow-up rows.');
  console.log(`Due now: ${result.due.length}`);
  for (const item of result.due.slice(0, 10)) {
    console.log(`- #${item.id} ${item.company} | ${item.role} | due ${item.followup_due} | ${item.next_action}`);
  }
  console.log(`Open next actions: ${result.open.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  printResult(runFollowupTracker(parseArgs(process.argv.slice(2))));
}
