#!/usr/bin/env node
/**
 * verify-pipeline.mjs — Health check for career-ops pipeline integrity
 *
 * Checks:
 * 1. All statuses are canonical (per states.yml)
 * 2. No duplicate company+role entries
 * 3. All report links point to existing files
 * 4. Scores match format X.XX/5, N/100, N%, N, N/A or DUP
 * 5. All rows have proper pipe-delimited format
 * 6. No pending TSVs in tracker-additions/ (only in merged/ or archived/)
 * 7. states.yml canonical IDs for cross-system consistency
 *
 * Run: node career-ops/verify-pipeline.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
// Support both layouts: data/applications.md (boilerplate) and applications.md (original)
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const ADDITIONS_DIR = join(CAREER_OPS, 'batch/tracker-additions');
const REPORTS_DIR = join(CAREER_OPS, 'reports');
const JOB_INDEX_FILE = join(CAREER_OPS, 'data/job-index.jsonl');
const ACTIONS_FILE = join(CAREER_OPS, 'data/application-actions.tsv');
const EMAIL_LEDGER_FILE = join(CAREER_OPS, 'data/email-drafts.tsv');
const STATES_FILE = existsSync(join(CAREER_OPS, 'templates/states.yml'))
  ? join(CAREER_OPS, 'templates/states.yml')
  : join(CAREER_OPS, 'states.yml');

const CANONICAL_STATUSES = [
  'evaluated', 'scheduled', 'applied', 'responded', 'interview',
  'offer', 'rejected', 'discarded', 'skip',
];

const ALIASES = {
  'evaluada': 'evaluated', 'condicional': 'evaluated', 'hold': 'evaluated', 'evaluar': 'evaluated', 'verificar': 'evaluated',
  'aplicado': 'applied', 'enviada': 'applied', 'aplicada': 'applied', 'applied': 'applied', 'sent': 'applied',
  'agendado': 'scheduled', 'agendada': 'scheduled',
  'respondido': 'responded',
  'entrevista': 'interview',
  'oferta': 'offer',
  'rechazado': 'rejected', 'rechazada': 'rejected',
  'descartado': 'discarded', 'descartada': 'discarded', 'cerrada': 'discarded', 'cancelada': 'discarded',
  'no aplicar': 'skip', 'no_aplicar': 'skip', 'monitor': 'skip', 'geo blocker': 'skip',
};

let errors = 0;
let warnings = 0;

function error(msg) { console.log(`❌ ${msg}`); errors++; }
function warn(msg) { console.log(`⚠️  ${msg}`); warnings++; }
function ok(msg) { console.log(`✅ ${msg}`); }

function isValidScore(raw) {
  const s = raw.replace(/\*\*/g, '').trim();
  if (s === 'N/A' || s === 'DUP') return true;

  const slash = s.match(/^(\d+(?:\.\d+)?)\/(5|100)$/);
  if (slash) {
    const value = parseFloat(slash[1]);
    const max = parseFloat(slash[2]);
    return value >= 0 && value <= max;
  }

  const percent = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (percent) {
    const value = parseFloat(percent[1]);
    return value >= 0 && value <= 100;
  }

  const plain = s.match(/^(\d+(?:\.\d+)?)$/);
  if (plain) {
    const value = parseFloat(plain[1]);
    return value >= 0 && value <= 100;
  }

  return false;
}

function extractLinkedInJobId(notes = '') {
  const match = notes.match(/\[linkedin-job-id:(\d+)\]/i);
  return match ? match[1] : null;
}

// --- Read applications.md ---
if (!existsSync(APPS_FILE)) {
  console.log('\n📊 No applications.md found. This is normal for a fresh setup.');
  console.log('   The file will be created when you evaluate your first offer.\n');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

const entries = [];
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 9) continue;
  const num = parseInt(parts[1]);
  if (isNaN(num)) continue;
  entries.push({
    num, date: parts[2], company: parts[3], role: parts[4],
    score: parts[5], status: parts[6], pdf: parts[7], report: parts[8],
    notes: parts[9] || '',
  });
}

console.log(`\n📊 Checking ${entries.length} entries in applications.md\n`);

// --- Check 1: Canonical statuses ---
let badStatuses = 0;
for (const e of entries) {
  const clean = e.status.replace(/\*\*/g, '').trim().toLowerCase();
  // Strip trailing dates
  const statusOnly = clean.replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();

  if (!CANONICAL_STATUSES.includes(statusOnly) && !ALIASES[statusOnly]) {
    error(`#${e.num}: Non-canonical status "${e.status}"`);
    badStatuses++;
  }

  // Check for markdown bold in status
  if (e.status.includes('**')) {
    error(`#${e.num}: Status contains markdown bold: "${e.status}"`);
    badStatuses++;
  }

  // Check for dates in status
  if (/\d{4}-\d{2}-\d{2}/.test(e.status)) {
    error(`#${e.num}: Status contains date: "${e.status}" — dates go in date column`);
    badStatuses++;
  }
}
if (badStatuses === 0) ok('All statuses are canonical');

// --- Check 2: Duplicates ---
const companyRoleMap = new Map();
let dupes = 0;
for (const e of entries) {
  const linkedInJobId = extractLinkedInJobId(e.notes);
  const key = e.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '::' +
    e.role.toLowerCase().replace(/[^a-z0-9 ]/g, '') +
    (linkedInJobId ? `::linkedin:${linkedInJobId}` : '');
  if (!companyRoleMap.has(key)) companyRoleMap.set(key, []);
  companyRoleMap.get(key).push(e);
}
for (const [key, group] of companyRoleMap) {
  if (group.length > 1) {
    warn(`Possible duplicates: ${group.map(e => `#${e.num}`).join(', ')} (${group[0].company} — ${group[0].role})`);
    dupes++;
  }
}
if (dupes === 0) ok('No exact duplicates found');

// --- Check 3: Report links ---
let brokenReports = 0;
for (const e of entries) {
  const match = e.report.match(/\]\(([^)]+)\)/);
  if (!match) continue;
  const reportPath = join(CAREER_OPS, match[1]);
  if (!existsSync(reportPath)) {
    error(`#${e.num}: Report not found: ${match[1]}`);
    brokenReports++;
  }
}
if (brokenReports === 0) ok('All report links valid');

// --- Check 4: Score format ---
let badScores = 0;
for (const e of entries) {
  const s = e.score.replace(/\*\*/g, '').trim();
  if (!isValidScore(s)) {
    error(`#${e.num}: Invalid score format: "${e.score}"`);
    badScores++;
  }
}
if (badScores === 0) ok('All scores valid');

// --- Check 5: Row format ---
let badRows = 0;
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  if (line.includes('---') || line.includes('Empresa')) continue;
  const parts = line.split('|');
  if (parts.length < 9) {
    error(`Row with <9 columns: ${line.substring(0, 80)}...`);
    badRows++;
  }
}
if (badRows === 0) ok('All rows properly formatted');

// --- Check 6: Pending TSVs ---
let pendingTsvs = 0;
if (existsSync(ADDITIONS_DIR)) {
  const files = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
  pendingTsvs = files.length;
  if (pendingTsvs > 0) {
    warn(`${pendingTsvs} pending TSVs in tracker-additions/ (not merged)`);
  }
}
if (pendingTsvs === 0) ok('No pending TSVs');

// --- Check 7: Bold in scores ---
let boldScores = 0;
for (const e of entries) {
  if (e.score.includes('**')) {
    warn(`#${e.num}: Score has markdown bold: "${e.score}"`);
    boldScores++;
  }
}
if (boldScores === 0) ok('No bold in scores');

// --- Check 8: Job index JSONL ---
let badIndexRows = 0;
let duplicateFingerprints = 0;
if (existsSync(JOB_INDEX_FILE)) {
  const fingerprints = new Map();
  const rows = readFileSync(JOB_INDEX_FILE, 'utf-8').split('\n').filter((line) => line.trim());
  rows.forEach((line, index) => {
    try {
      const record = JSON.parse(line);
      if (!record.fingerprint && !record.canonical_url) {
        error(`job-index.jsonl line ${index + 1}: missing fingerprint/canonical_url`);
        badIndexRows++;
      }
      if (record.fingerprint) {
        const count = fingerprints.get(record.fingerprint) || 0;
        fingerprints.set(record.fingerprint, count + 1);
      }
    } catch {
      error(`job-index.jsonl line ${index + 1}: invalid JSON`);
      badIndexRows++;
    }
  });
  for (const [fingerprint, count] of fingerprints) {
    if (count > 1) {
      warn(`job-index duplicate fingerprint (${count}x): ${fingerprint}`);
      duplicateFingerprints++;
    }
  }
  if (badIndexRows === 0 && duplicateFingerprints === 0) ok('Job index valid');
} else {
  ok('Job index not created yet');
}

// --- Check 9: Tracker/action/email reconciliation ---
let stateMismatches = 0;
const entriesById = new Map(entries.map((entry) => [String(entry.num), entry]));
if (existsSync(ACTIONS_FILE)) {
  const actionRows = readFileSync(ACTIONS_FILE, 'utf-8').split(/\r?\n/).slice(1).filter(Boolean);
  for (const row of actionRows) {
    const fields = row.split('\t');
    const applicationId = String(Number(fields[1] || 0));
    const actionStatus = fields[8] || '';
    const application = entriesById.get(applicationId);
    if (application?.status.toLowerCase() === 'applied' && actionStatus.startsWith('ready_')) {
      error(`#${applicationId}: Applied application still has ready action "${actionStatus}"`);
      stateMismatches++;
    }
  }
}

const emailApplicationIds = new Set();
if (existsSync(EMAIL_LEDGER_FILE)) {
  for (const row of readFileSync(EMAIL_LEDGER_FILE, 'utf-8').split(/\r?\n/).slice(1).filter(Boolean)) {
    const fields = row.split('\t');
    if (fields[1]) emailApplicationIds.add(String(Number(fields[1])));
  }
}
for (const application of entries) {
  if (application.status.toLowerCase() === 'scheduled' && !emailApplicationIds.has(String(application.num))) {
    error(`#${application.num}: Scheduled application missing from email ledger`);
    stateMismatches++;
  }
}
if (stateMismatches === 0) ok('Tracker, actions and email ledger reconciled');

// --- Summary ---
console.log('\n' + '='.repeat(50));
console.log(`📊 Pipeline Health: ${errors} errors, ${warnings} warnings`);
if (errors === 0 && warnings === 0) {
  console.log('🟢 Pipeline is clean!');
} else if (errors === 0) {
  console.log('🟡 Pipeline OK with warnings');
} else {
  console.log('🔴 Pipeline has errors — fix before proceeding');
}

process.exit(errors > 0 ? 1 : 0);
