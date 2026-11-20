#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { checkSingleUrl } from './check-liveness.mjs';
import {
  applicationsPath,
  loadApplications,
  splitMarkdownTableRow,
} from './lib/applications-store.mjs';
import { buildLocalEmailDrafts } from './email-drafts.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export async function verifyAndCreateDraft(options = {}) {
  const root = options.projectRoot || projectRoot;
  const applicationID = Number(options.id);
  const application = loadApplications(root).find((item) => item.id === applicationID);
  if (!application) {
    return { ok: false, blocked: true, reason: `vaga #${applicationID || '?'} não encontrada` };
  }

  const reportPath = resolve(root, application.report_path || '');
  if (!application.report_path || !existsSync(reportPath)) {
    return { ok: false, blocked: true, reason: 'report da vaga em falta' };
  }
  const report = readFileSync(reportPath, 'utf-8');
  const jobURL = report.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+)/mi)?.[1] || '';
  if (!jobURL) {
    return { ok: false, blocked: true, reason: 'URL da vaga em falta no report' };
  }

  const verification = await checkSingleUrl(jobURL, {
    expectedRole: application.role,
    visible: options.visible === true,
  });
  const timestamp = new Date().toISOString();
  updateTrackerVerification(root, applicationID, {
    timestamp,
    state: verification.result,
    reason: verification.reason,
    source: safeHostname(verification.final_url || jobURL),
  });

  if (verification.result !== 'active') {
    return {
      ok: false,
      blocked: true,
      reason: `vaga ${verification.result}: ${verification.reason}`,
      verification,
    };
  }

  const result = buildLocalEmailDrafts({
    projectRoot: root,
    id: String(applicationID),
  });
  const selected = result.selected[0];
  if (!selected) {
    return { ok: false, blocked: true, reason: 'não foi possível selecionar a vaga para o draft', verification };
  }
  const status = selected.record.status;
  if (status.startsWith('blocked_')) {
    return {
      ok: false,
      blocked: true,
      reason: draftStatusReason(status),
      status,
      output: selected.output,
      verification,
    };
  }

  return {
    ok: true,
    blocked: false,
    status,
    output: selected.output,
    attachment: selected.record.planned_attachment,
    recipient: selected.record.to,
    verification,
  };
}

export function updateTrackerVerification(root, applicationID, verification) {
  const file = applicationsPath(root);
  const original = readFileSync(file, 'utf-8');
  const lines = original.split(/\r?\n/);
  let updated = false;

  const next = lines.map((line) => {
    if (!new RegExp(`^\\|\\s*${applicationID}\\s*\\|`).test(line)) return line;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 9) return line;
    const cleaned = String(cells[8] || '')
      .replace(/\s*\[live-(?:verified|checked|method|state|source):[^\]]+\]/gi, '')
      .replace(/\s*Última verificação live Playwright:[^|]*/gi, '')
      .trim();
    const stateMarker = verification.state === 'active'
      ? `[live-verified:${verification.timestamp}]`
      : `[live-checked:${verification.timestamp}]`;
    const reason = sanitizeTrackerText(verification.reason);
    const source = sanitizeTrackerText(verification.source);
    cells[8] = [
      cleaned,
      stateMarker,
      '[live-method:playwright]',
      `[live-state:${verification.state}]`,
      source ? `[live-source:${source}]` : '',
      `Última verificação live Playwright: ${verification.state}${reason ? ` (${reason})` : ''}.`,
    ].filter(Boolean).join(' ');
    updated = true;
    return `| ${cells.join(' | ')} |`;
  });

  if (!updated) throw new Error(`tracker row #${applicationID} not found`);
  const temp = `${file}.verification.tmp`;
  writeFileSync(temp, next.join('\n'), 'utf-8');
  renameSync(temp, file);
}

function draftStatusReason(status) {
  const reasons = {
    blocked_missing_draft: 'o report não contém um texto de email utilizável',
    blocked_missing_report: 'o report da vaga está em falta',
    blocked_missing_cv: 'o CV selecionado está em falta',
    blocked_unverified_vacancy: 'a prova live não foi aceite',
  };
  return reasons[status] || status;
}

function sanitizeTrackerText(value) {
  return String(value || '')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function safeHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const options = { id: '', visible: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--id') options.id = argv[++index] || '';
    else if (arg === '--visible') options.visible = true;
    else if (arg === '--json') options.json = true;
  }
  return options;
}

function printResult(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    console.log(`DRAFT_BLOCKED: ${result.reason}`);
    if (result.verification?.final_url) console.log(`URL final: ${result.verification.final_url}`);
    return;
  }
  console.log(`DRAFT_READY: ${result.status}`);
  console.log(`Ficheiro: ${result.output}`);
  console.log(`CV: ${result.attachment}`);
  console.log(`Destinatário: ${result.recipient}`);
  console.log('O email não foi enviado.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  verifyAndCreateDraft(options)
    .then((result) => {
      printResult(result, options.json);
      if (!result.ok) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(`DRAFT_FAILED: ${error.message}`);
      process.exitCode = 1;
    });
}
