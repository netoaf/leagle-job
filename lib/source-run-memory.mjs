import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-file.mjs';
import { classifyAuditEnvironment } from '../portal-audit.mjs';

const NETWORK_ERROR = /\b(?:EACCES|EPERM|ENETUNREACH|EHOSTUNREACH|ENETDOWN|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|DNS_RESOLUTION_FAILED|REQUEST_TIMEOUT)\b|hostname resolution failed|network is unreachable|request timed out|fetch failed/i;

export const SOURCE_RUN_CONTRACT_VERSION = '1';
export const SOURCE_RUN_COLUMNS = [
  'timestamp',
  'run_id',
  'contract_version',
  'runner',
  'profile',
  'mode',
  'source',
  'source_type',
  'outcome',
  'discovered',
  'captured',
  'qualified',
  'selected',
  'error_kind',
];
export const SOURCE_RUNS_HEADER = `${SOURCE_RUN_COLUMNS.join('\t')}\n`;
export const SOURCE_OUTCOMES = new Set([
  'source_failure',
  'zero_acquisition',
  'capture_gap',
  'no_candidate_fit',
  'healthy',
]);
const ERROR_KINDS = new Set([
  'none',
  'network',
  'auth',
  'rate_limited',
  'server',
  'not_found',
  'unknown',
]);
const NUMERIC_COLUMNS = new Set(['discovered', 'captured', 'qualified', 'selected']);

export function classifySourceOutcome(values = {}) {
  if (String(values.error || '').trim()) return 'source_failure';

  const discovered = nonNegativeInteger(values.discovered);
  const captured = nonNegativeInteger(values.captured ?? values.accepted);
  const selected = nonNegativeInteger(values.selected);

  if (discovered === 0) return 'zero_acquisition';
  if (captured === 0) {
    return allSkipsAreKnownOrDuplicate(values.skip_reasons) ? 'healthy' : 'capture_gap';
  }
  if (selected === 0) return 'no_candidate_fit';
  return 'healthy';
}

export function classifyErrorKind(error) {
  const text = String(error || '').trim();
  if (!text) return 'none';
  if (/\b(?:429|rate[ -]?limit|too many requests)\b/i.test(text)) return 'rate_limited';
  if (/\b(?:401|403|unauthori[sz]ed|forbidden|access denied)\b/i.test(text)) return 'auth';
  if (/\b(?:404|410|not found|gone)\b/i.test(text)) return 'not_found';
  if (/\b5\d{2}\b|server error|bad gateway|service unavailable|gateway timeout/i.test(text)) return 'server';
  if (NETWORK_ERROR.test(text)) return 'network';
  return 'unknown';
}

export function createComparableSourceKey(record = {}) {
  return [
    record.contract_version ?? SOURCE_RUN_CONTRACT_VERSION,
    record.runner,
    record.profile,
    record.mode,
    record.source_type,
    record.source,
  ].map(normalizeKeyPart).join('\u001f');
}

export function parseSourceRunLedger(content) {
  const lines = String(content ?? '').replace(/\r/g, '').split('\n');
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
  if (lines.length === 0) {
    return { compatible: true, header: [...SOURCE_RUN_COLUMNS], records: [], warnings: [] };
  }

  const header = lines[0].split('\t').map((column) => column.trim());
  const missing = SOURCE_RUN_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      compatible: false,
      header,
      records: [],
      warnings: [`Incompatible source-run ledger header; missing column(s): ${missing.join(', ')}`],
    };
  }

  const records = [];
  const warnings = [];
  for (let index = 1; index < lines.length; index++) {
    const lineNumber = index + 1;
    if (!lines[index].trim()) continue;
    const cells = lines[index].split('\t');
    if (cells.length !== header.length) {
      warnings.push(`Ignored invalid source-run row at line ${lineNumber}: wrong column count.`);
      continue;
    }
    const raw = Object.fromEntries(header.map((column, cellIndex) => [column, cells[cellIndex]]));
    const normalized = normalizeLedgerRecord(raw);
    if (!normalized) {
      warnings.push(`Ignored invalid source-run row at line ${lineNumber}: invalid value.`);
      continue;
    }
    records.push(normalized);
  }

  return { compatible: true, header, records, warnings };
}

export function readSourceRunLedger(filePath) {
  if (!existsSync(filePath)) {
    return { compatible: true, header: [...SOURCE_RUN_COLUMNS], records: [], warnings: [] };
  }
  return parseSourceRunLedger(readFileSync(filePath, 'utf8'));
}

export function appendSourceRunRecords(filePath, records, options = {}) {
  const additions = Array.isArray(records) ? records : [];
  if (additions.length === 0) return filePath;

  const exists = existsSync(filePath);
  const previous = exists ? readFileSync(filePath, 'utf8') : '';
  const parsed = parseSourceRunLedger(previous);
  if (!parsed.compatible) {
    throw new Error(parsed.warnings[0] || 'Incompatible source-run ledger.');
  }

  const header = exists && previous.trim() ? parsed.header : [...SOURCE_RUN_COLUMNS];
  const rows = additions.map((record) => {
    const normalized = normalizeLedgerRecord(record);
    if (!normalized) throw new Error('Invalid source-run record; ledger was not changed.');
    return header.map((column) => sanitizeTsvCell(normalized[column] ?? '')).join('\t');
  });
  const prefix = exists && previous.trim()
    ? `${previous.replace(/\r/g, '').replace(/\n*$/, '')}\n`
    : `${header.join('\t')}\n`;
  writeFileAtomic(filePath, `${prefix}${rows.join('\n')}\n`, options.atomicOptions);
  return filePath;
}

export function computeSourceReliability(records, options = {}) {
  const threshold = positiveInteger(options.threshold, 3);
  const states = new Map();
  const comparableRuns = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const normalized = normalizeLedgerRecord(record);
    if (!normalized) continue;
    const key = createComparableSourceKey(normalized);
    const runKey = `${key}\u001e${normalizeKeyPart(normalized.run_id)}`;
    // A scanner bug or a manually duplicated row must not turn one execution
    // into several consecutive failures. Last observation wins for that run.
    comparableRuns.delete(runKey);
    comparableRuns.set(runKey, { key, normalized });
  }

  for (const { key, normalized } of comparableRuns.values()) {
    const state = states.get(key) || {
      key,
      contract_version: normalized.contract_version,
      runner: normalized.runner,
      profile: normalized.profile,
      mode: normalized.mode,
      source: normalized.source,
      source_type: normalized.source_type,
      failure_streak: 0,
      zero_streak: 0,
      last_outcome: '',
      last_run_at: '',
    };

    if (normalized.outcome === 'source_failure') {
      state.failure_streak += 1;
      state.zero_streak = 0;
    } else if (normalized.outcome === 'zero_acquisition') {
      state.zero_streak += 1;
      state.failure_streak = 0;
    } else {
      state.failure_streak = 0;
      state.zero_streak = 0;
    }
    state.last_outcome = normalized.outcome;
    state.last_run_at = normalized.timestamp;
    states.set(key, state);
  }

  const sources = [...states.values()].sort(compareReliabilityState);
  const alerts = [];
  for (const state of sources) {
    if (state.failure_streak >= threshold) {
      alerts.push(createAlert(state, 'source_failure', 'high', state.failure_streak));
    } else if (state.zero_streak >= threshold) {
      alerts.push(createAlert(state, 'zero_acquisition', 'medium', state.zero_streak));
    }
  }
  return { threshold, sources, alerts };
}

export function compareSourceReliability(before, after) {
  const previousAlerts = new Map((before?.alerts || []).map((alert) => [alert.id, alert]));
  const currentAlerts = new Map((after?.alerts || []).map((alert) => [alert.id, alert]));
  return {
    newly_active: [...currentAlerts.values()].filter((alert) => !previousAlerts.has(alert.id)),
    active: [...currentAlerts.values()],
    resolved: [...previousAlerts.values()].filter((alert) => !currentAlerts.has(alert.id)),
  };
}

export function prepareSourceRunBatch(input = {}) {
  const sourceStats = Array.isArray(input.source_stats) ? input.source_stats : [];
  const environment = classifyAuditEnvironment(sourceStats.map((stat) => ({
    status: String(stat?.error || '').trim() ? 'fetch_failed' : 'healthy',
    http_code: httpStatusFromError(stat?.error),
    error: stat?.error || '',
  })));
  if (environment.status === 'environment_failure') {
    return { environment, records: [] };
  }

  const matchers = sourceStats
    .map((stat) => ({ stat, normalized: normalizeKeyPart(stat?.source) }))
    .filter((item) => item.normalized)
    .sort((a, b) => b.normalized.length - a.normalized.length);
  const qualifiedCounts = countJobsByAttemptedSource(input.qualified_jobs, matchers);
  const selectedCounts = countJobsByAttemptedSource(input.selected_jobs, matchers);
  const timestamp = String(input.timestamp || new Date().toISOString());
  const runId = String(input.run_id || timestamp);

  const records = sourceStats
    .filter((stat) => String(stat?.source || '').trim() && String(stat?.type || '').trim())
    .map((stat) => {
      const sourceKey = normalizeKeyPart(stat.source);
      const discovered = nonNegativeInteger(stat.discovered);
      const captured = nonNegativeInteger(stat.accepted ?? stat.captured);
      const qualified = qualifiedCounts.get(sourceKey) || 0;
      const selected = selectedCounts.get(sourceKey) || 0;
      return {
        timestamp,
        run_id: runId,
        contract_version: SOURCE_RUN_CONTRACT_VERSION,
        runner: input.runner || 'scan-and-rank',
        profile: input.profile || 'unknown',
        mode: input.mode || 'new-only',
        source: stat.source,
        source_type: stat.type,
        outcome: classifySourceOutcome({
          error: stat.error,
          discovered,
          captured,
          qualified,
          selected,
          skip_reasons: stat.skip_reasons,
        }),
        discovered,
        captured,
        qualified,
        selected,
        error_kind: classifyErrorKind(stat.error),
      };
    });

  return { environment, records };
}

export function recordSourceRunMemory(input = {}, options = {}) {
  if (input.dry_run) return { recorded: false, reason: 'dry_run' };
  if (input.replay_input) return { recorded: false, reason: 'replay_input' };

  const batch = prepareSourceRunBatch(input);
  if (batch.environment.status === 'environment_failure') {
    return {
      recorded: false,
      reason: 'environment_failure',
      environment: batch.environment,
    };
  }
  if (batch.records.length === 0) {
    return {
      recorded: false,
      reason: 'no_attempted_sources',
      environment: batch.environment,
    };
  }

  const filePath = input.file_path || join(input.project_root || process.cwd(), 'data', 'source-runs.tsv');
  const beforeLedger = readSourceRunLedger(filePath);
  if (!beforeLedger.compatible) {
    return {
      recorded: false,
      reason: 'persistence_error',
      error_code: 'INCOMPATIBLE_SCHEMA',
      environment: batch.environment,
      warnings: beforeLedger.warnings,
    };
  }

  const before = computeSourceReliability(beforeLedger.records, input);
  try {
    appendSourceRunRecords(filePath, batch.records, options);
  } catch (error) {
    return {
      recorded: false,
      reason: 'persistence_error',
      error_code: sanitizedErrorCode(error?.code),
      environment: batch.environment,
      warnings: beforeLedger.warnings,
    };
  }
  const after = computeSourceReliability([...beforeLedger.records, ...batch.records], input);

  return {
    recorded: true,
    reason: 'recorded',
    rows_recorded: batch.records.length,
    environment: batch.environment,
    warnings: beforeLedger.warnings,
    reliability: after,
    transitions: compareSourceReliability(before, after),
  };
}

function allSkipsAreKnownOrDuplicate(reasons) {
  const entries = Object.entries(reasons || {})
    .filter(([, count]) => nonNegativeInteger(count) > 0);
  return entries.length > 0
    && entries.every(([reason]) => /^(?:known|duplicate)_/i.test(String(reason)));
}

function normalizeLedgerRecord(record) {
  const timestamp = sanitizeTsvCell(record?.timestamp);
  const runId = sanitizeTsvCell(record?.run_id);
  const contractVersion = sanitizeTsvCell(record?.contract_version);
  const runner = sanitizeTsvCell(record?.runner);
  const profile = sanitizeTsvCell(record?.profile);
  const mode = sanitizeTsvCell(record?.mode);
  const source = sanitizeTsvCell(record?.source);
  const sourceType = sanitizeTsvCell(record?.source_type);
  const outcome = sanitizeTsvCell(record?.outcome);
  const errorKind = sanitizeTsvCell(record?.error_kind);
  const timestampDate = new Date(timestamp);

  if (
    !timestamp
    || Number.isNaN(timestampDate.valueOf())
    || !runId
    || !contractVersion
    || !runner
    || !profile
    || !mode
    || !source
    || !sourceType
    || !SOURCE_OUTCOMES.has(outcome)
    || !ERROR_KINDS.has(errorKind)
  ) return null;

  const normalized = {
    timestamp,
    run_id: runId,
    contract_version: contractVersion,
    runner,
    profile,
    mode,
    source,
    source_type: sourceType,
    outcome,
    error_kind: errorKind,
  };
  for (const column of NUMERIC_COLUMNS) {
    const value = Number(record?.[column]);
    if (!Number.isInteger(value) || value < 0) return null;
    normalized[column] = value;
  }
  return normalized;
}

function createAlert(state, kind, severity, streak) {
  return {
    id: `${state.key}\u001f${kind}`,
    key: state.key,
    kind,
    severity,
    streak,
    contract_version: state.contract_version,
    runner: state.runner,
    profile: state.profile,
    mode: state.mode,
    source: state.source,
    source_type: state.source_type,
    last_run_at: state.last_run_at,
  };
}

function countJobsByAttemptedSource(items, matchers) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const job = item?.job || item;
    const jobSource = normalizeKeyPart(job?.source);
    if (!jobSource) continue;
    const match = matchers.find(({ normalized }) => (
      jobSource === normalized || jobSource.startsWith(`${normalized} `)
    ));
    if (!match) continue;
    counts.set(match.normalized, (counts.get(match.normalized) || 0) + 1);
  }
  return counts;
}

function httpStatusFromError(error) {
  const match = String(error || '').match(/\bHTTP(?:\s+status)?\s*[:=]?\s*([1-5]\d{2})\b/i);
  return match?.[1] || '';
}

function sanitizedErrorCode(code) {
  const value = String(code || 'SOURCE_RUN_WRITE_FAILED')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .slice(0, 48);
  return value || 'SOURCE_RUN_WRITE_FAILED';
}

function compareReliabilityState(a, b) {
  return a.source.localeCompare(b.source)
    || a.profile.localeCompare(b.profile)
    || a.mode.localeCompare(b.mode)
    || a.source_type.localeCompare(b.source_type);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function normalizeKeyPart(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function sanitizeTsvCell(value) {
  return String(value ?? '')
    .replace(/[\t\r\n\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
