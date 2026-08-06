import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const APPLICATION_ACTIONS_HEADER = [
  'id',
  'application_id',
  'report_number',
  'company',
  'role',
  'channel',
  'apply_url',
  'recipient',
  'status',
  'blocker',
  'next_action',
  'created_at',
  'updated_at',
  'notes',
].join('\t');

export function applicationActionsPath(root, options = {}) {
  return join(root, options.file || 'data/application-actions.tsv');
}

export function loadApplicationActions(root, options = {}) {
  const file = applicationActionsPath(root, options);
  const rows = new Map();
  if (!existsSync(file)) return rows;

  for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    const row = parseActionLine(line);
    if (row.report_number) rows.set(row.report_number, row);
  }
  return rows;
}

export function upsertApplicationActions(root, records, options = {}) {
  const file = applicationActionsPath(root, options);
  const existing = loadApplicationActions(root, options);
  for (const record of records) {
    const current = existing.get(record.report_number);
    existing.set(record.report_number, {
      ...current,
      ...record,
      id: current?.id || record.id,
      created_at: current?.created_at || record.created_at,
    });
  }

  const sorted = [...existing.values()].sort((a, b) =>
    Number(a.application_id || 0) - Number(b.application_id || 0));
  const lines = [
    APPLICATION_ACTIONS_HEADER,
    ...sorted.map(formatActionLine),
  ];
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');
}

export function summarizeApplicationActions(root, options = {}) {
  const rows = [...loadApplicationActions(root, options).values()];
  const counts = {};
  for (const row of rows) {
    const status = row.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return { total: rows.length, counts };
}

function parseActionLine(line) {
  const fields = line.split('\t');
  return {
    id: fields[0] || '',
    application_id: fields[1] || '',
    report_number: fields[2] || '',
    company: fields[3] || '',
    role: fields[4] || '',
    channel: fields[5] || '',
    apply_url: fields[6] || '',
    recipient: fields[7] || '',
    status: fields[8] || '',
    blocker: fields[9] || '',
    next_action: fields[10] || '',
    created_at: fields[11] || '',
    updated_at: fields[12] || '',
    notes: fields[13] || '',
  };
}

function formatActionLine(row) {
  return [
    row.id,
    row.application_id,
    row.report_number,
    row.company,
    row.role,
    row.channel,
    row.apply_url,
    row.recipient,
    row.status,
    row.blocker,
    row.next_action,
    row.created_at,
    row.updated_at,
    row.notes,
  ].map(tsvCell).join('\t');
}

function tsvCell(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}
