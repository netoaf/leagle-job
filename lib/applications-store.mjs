import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { normalizeText } from './job-normalizer.mjs';

export const APPLICATIONS_HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';

export function applicationsPath(root) {
  return join(root, 'data', 'applications.md');
}

export function loadApplications(root, options = {}) {
  const file = options.file || applicationsPath(root);
  if (!existsSync(file)) return [];
  return parseApplicationsMarkdown(readFileSync(file, 'utf-8'));
}

export function parseApplicationsMarkdown(markdown) {
  const rows = [];
  for (const line of String(markdown || '').split('\n')) {
    const application = parseApplicationRow(line);
    if (application) rows.push(application);
  }
  return rows;
}

export function parseApplicationRow(line) {
  if (!/^\|\s*\d+\s*\|/.test(String(line || ''))) return null;

  const cells = splitMarkdownTableRow(line);
  const id = Number(cells[0]);
  if (!Number.isFinite(id)) return null;

  const report = cells[7] || '';
  const reportLink = extractMarkdownLink(report);
  const reportNumber = reportLink.label && /^\d+$/.test(reportLink.label)
    ? reportLink.label.padStart(3, '0')
    : String(id).padStart(3, '0');

  return {
    id,
    report_number: reportNumber,
    date: cells[1] || '',
    company: repairMojibakeText(cells[2] || ''),
    role: repairMojibakeText(cells[3] || ''),
    score: cells[4] || '',
    score_number: scoreNumber(cells[4] || ''),
    status: repairMojibakeText(cells[5] || ''),
    status_normalized: normalizeStatus(cells[5] || ''),
    pdf: cells[6] || '',
    report: repairMojibakeText(report),
    report_path: reportLink.href || '',
    notes: repairMojibakeText(cells[8] || ''),
    raw_line: line,
  };
}

export function selectApplications(applications, options = {}) {
  if (options.id) {
    const wanted = new Set(String(options.id)
      .split(',')
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite));
    return applications.filter((application) => wanted.has(application.id));
  }

  const top = Number(options.top || 10);
  const minScore = Number(options.minScore || 70);
  return applications
    .filter((application) => application.score_number >= minScore)
    .filter((application) => isActionableStatus(application.status))
    .sort((a, b) => b.score_number - a.score_number || a.id - b.id)
    .slice(0, Number.isFinite(top) && top > 0 ? top : 10);
}

export function isActionableStatus(status) {
  const text = normalizeStatus(status);
  if (!text) return false;
  return !['skip', 'discard', 'discarded', 'rejected', 'applied', 'interview', 'offer'].includes(text);
}

export function isClosedStatus(status) {
  const text = normalizeStatus(status);
  return ['skip', 'discard', 'discarded', 'rejected'].includes(text);
}

export function normalizeStatus(status) {
  return normalizeText(status);
}

export function scoreNumber(value) {
  return Number.parseFloat(String(value || '').replace(',', '.')) || 0;
}

export function summarizeApplications(applications) {
  const summary = {
    total: applications.length,
    evaluated: 0,
    applied: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    skip: 0,
    actionable: 0,
    top: [],
  };

  for (const application of applications) {
    const status = normalizeStatus(application.status);
    if (status === 'evaluated') summary.evaluated += 1;
    else if (status === 'applied') summary.applied += 1;
    else if (status === 'interview') summary.interview += 1;
    else if (status === 'offer') summary.offer += 1;
    else if (status === 'rejected') summary.rejected += 1;
    else if (status === 'skip') summary.skip += 1;
    if (isActionableStatus(application.status)) summary.actionable += 1;
  }

  summary.top = [...applications]
    .filter((application) => application.score_number > 0)
    .sort((a, b) => b.score_number - a.score_number || a.id - b.id)
    .slice(0, 12);

  return summary;
}

export function splitMarkdownTableRow(line) {
  const text = String(line || '').trim();
  const withoutEdges = text.startsWith('|') ? text.slice(1, text.endsWith('|') ? -1 : undefined) : text;
  return withoutEdges.split('|').map((cell) => cell.trim());
}

export function extractMarkdownLink(value) {
  const match = String(value || '').match(/\[([^\]]+)\]\(([^)]+)\)/);
  return {
    label: match?.[1] || '',
    href: match?.[2] || '',
  };
}

export function repairMojibakeText(value) {
  const text = String(value ?? '');
  if (!/[\u00c3\u00c2\u00e2]/.test(text)) return text;
  const repaired = Buffer.from(text, 'latin1').toString('utf8');
  return mojibakeScore(repaired) < mojibakeScore(text) ? repaired : text;
}

function mojibakeScore(text) {
  return (String(text || '').match(/[\u00c3\u00c2\u00e2\ufffd]/g) || []).length;
}
