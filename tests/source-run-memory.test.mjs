import test from 'node:test';
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

import {
  SOURCE_RUNS_HEADER,
  appendSourceRunRecords,
  classifyErrorKind,
  classifySourceOutcome,
  compareSourceReliability,
  computeSourceReliability,
  createComparableSourceKey,
  parseSourceRunLedger,
  prepareSourceRunBatch,
  recordSourceRunMemory,
} from '../lib/source-run-memory.mjs';
import { buildSourceRunMemoryInput } from '../scan-and-rank.mjs';
import {
  formatSourceReliabilitySummary,
  getSourceReliabilityStatus,
} from '../source-reliability.mjs';

test('classifies acquisition, capture and fit outcomes without calling no-fit sources broken', () => {
  assert.equal(classifySourceOutcome({ error: 'getaddrinfo ENOTFOUND jobs.example.test' }), 'source_failure');
  assert.equal(classifySourceOutcome({ discovered: 0, captured: 0, qualified: 0, selected: 0 }), 'zero_acquisition');
  assert.equal(classifySourceOutcome({
    discovered: 2,
    captured: 0,
    qualified: 0,
    selected: 0,
    skip_reasons: { missing_link: 2 },
  }), 'capture_gap');
  assert.equal(classifySourceOutcome({
    discovered: 2,
    captured: 0,
    qualified: 0,
    selected: 0,
    skip_reasons: { known_url: 1, duplicate_identity: 1 },
  }), 'healthy');
  assert.equal(classifySourceOutcome({ discovered: 2, captured: 2, qualified: 1, selected: 0 }), 'no_candidate_fit');
  assert.equal(classifySourceOutcome({ discovered: 2, captured: 2, qualified: 1, selected: 1 }), 'healthy');
});

test('reduces raw failures to a bounded error-kind vocabulary', () => {
  assert.equal(classifyErrorKind('getaddrinfo ENOTFOUND secret.internal.test'), 'network');
  assert.equal(classifyErrorKind('HTTP 403 from private.example.test'), 'auth');
  assert.equal(classifyErrorKind('HTTP 429 too many requests'), 'rate_limited');
  assert.equal(classifyErrorKind('HTTP 503 upstream failed'), 'server');
  assert.equal(classifyErrorKind('fetch failed after HTTP 503 Service Unavailable'), 'server');
  assert.equal(classifyErrorKind('HTTP 404'), 'not_found');
  assert.equal(classifyErrorKind('unexpected parser shape containing private text'), 'unknown');
  assert.equal(classifyErrorKind(''), 'none');
});

test('comparable keys normalize casing but isolate profile, mode and source type', () => {
  const base = {
    contract_version: '1',
    runner: 'scan-and-rank',
    profile: 'pt',
    mode: 'new-only',
    source_type: 'job_board',
    source: 'ITJobs.pt',
  };
  const same = createComparableSourceKey({ ...base, source: '  itjobs.PT  ' });
  assert.equal(createComparableSourceKey(base), same);
  assert.notEqual(createComparableSourceKey(base), createComparableSourceKey({ ...base, profile: 'remote' }));
  assert.notEqual(createComparableSourceKey(base), createComparableSourceKey({ ...base, mode: 'audit' }));
  assert.notEqual(createComparableSourceKey(base), createComparableSourceKey({ ...base, source_type: 'portugal_priority' }));
});

test('persists sanitized records atomically and parses columns by header name', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-source-runs-'));
  const file = join(root, 'source-runs.tsv');
  const record = sourceRunRecord({ source: 'ITJobs.pt\tprivate-marker', error: 'raw-secret-must-not-persist' });

  try {
    appendSourceRunRecords(file, [record]);
    const content = readFileSync(file, 'utf8');
    assert.match(content, /^timestamp\trun_id\tcontract_version\t/);
    assert.doesNotMatch(content, /raw-secret-must-not-persist/);
    assert.match(content, /ITJobs\.pt private-marker/);

    const parsed = parseSourceRunLedger(content);
    assert.equal(parsed.compatible, true);
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.records[0].source, 'ITJobs.pt private-marker');

    const columns = SOURCE_RUNS_HEADER.trimEnd().split('\t');
    const reordered = [...columns].reverse();
    const values = Object.fromEntries(columns.map((column) => [column, String(parsed.records[0][column] ?? '')]));
    const reorderedContent = `${reordered.join('\t')}\n${reordered.map((column) => values[column]).join('\t')}\n`;
    const parsedReordered = parseSourceRunLedger(reorderedContent);
    assert.equal(parsedReordered.compatible, true);
    assert.equal(parsedReordered.records[0].source, 'ITJobs.pt private-marker');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores torn rows and fails closed on an incompatible ledger header', () => {
  const valid = `${SOURCE_RUNS_HEADER}${sourceRunRow(sourceRunRecord())}\n`;
  const torn = `${valid}2026-08-25T10:00:00.000Z\tpartial\n`;
  const parsed = parseSourceRunLedger(torn);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /line 3/i);

  const incompatible = parseSourceRunLedger('timestamp\toutcome\n2026-08-25T10:00:00.000Z\thealthy\n');
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.records.length, 0);
  assert.match(incompatible.warnings[0], /incompatible/i);
});

test('atomic append failure preserves every byte of the previous ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-source-runs-atomic-'));
  const file = join(root, 'source-runs.tsv');
  const previous = `${SOURCE_RUNS_HEADER}${sourceRunRow(sourceRunRecord())}\n`;
  writeFileSync(file, previous, 'utf8');

  try {
    assert.throws(() => appendSourceRunRecords(file, [sourceRunRecord({ run_id: 'second' })], {
      atomicOptions: {
        renameFile() {
          const error = new Error('simulated source ledger replacement failure');
          error.code = 'EACCES';
          throw error;
        },
      },
    }), /simulated source ledger replacement failure/);
    assert.equal(readFileSync(file, 'utf8'), previous);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to append over an incompatible ledger instead of replacing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-source-runs-schema-'));
  const file = join(root, 'source-runs.tsv');
  const previous = 'timestamp\toutcome\n2026-08-25T10:00:00.000Z\thealthy\n';
  writeFileSync(file, previous, 'utf8');

  try {
    assert.throws(() => appendSourceRunRecords(file, [sourceRunRecord()]), /incompatible/i);
    assert.equal(readFileSync(file, 'utf8'), previous);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('activates source-failure and zero-acquisition alerts only on the third comparable run', () => {
  const twoFailures = computeSourceReliability(sourceRunSequence(['source_failure', 'source_failure']));
  assert.equal(twoFailures.alerts.length, 0);

  const threeFailures = computeSourceReliability(sourceRunSequence(['source_failure', 'source_failure', 'source_failure']));
  assert.equal(threeFailures.alerts.length, 1);
  assert.deepEqual(pickAlert(threeFailures.alerts[0]), {
    kind: 'source_failure',
    severity: 'high',
    streak: 3,
  });

  const twoZeros = computeSourceReliability(sourceRunSequence(['zero_acquisition', 'zero_acquisition']));
  assert.equal(twoZeros.alerts.length, 0);

  const threeZeros = computeSourceReliability(sourceRunSequence(['zero_acquisition', 'zero_acquisition', 'zero_acquisition']));
  assert.deepEqual(pickAlert(threeZeros.alerts[0]), {
    kind: 'zero_acquisition',
    severity: 'medium',
    streak: 3,
  });
});

test('counts one comparable source at most once per run id', () => {
  const duplicate = sourceRunSequence(['source_failure'])[0];
  const reliability = computeSourceReliability([duplicate, duplicate, duplicate]);
  assert.equal(reliability.alerts.length, 0);
  assert.equal(reliability.sources[0].failure_streak, 1);
});

test('healthy, no-fit and capture-gap outcomes reset alert streaks', () => {
  for (const resetOutcome of ['healthy', 'no_candidate_fit', 'capture_gap']) {
    const reliability = computeSourceReliability(sourceRunSequence([
      'source_failure',
      'source_failure',
      'source_failure',
      resetOutcome,
    ]));
    assert.equal(reliability.alerts.length, 0, resetOutcome);
    assert.equal(reliability.sources[0].failure_streak, 0, resetOutcome);
    assert.equal(reliability.sources[0].zero_streak, 0, resetOutcome);
  }
});

test('streaks remain isolated by comparable key and unattempted sources do not change state', () => {
  const records = [
    ...sourceRunSequence(['source_failure', 'source_failure'], { profile: 'pt' }),
    ...sourceRunSequence(['source_failure'], { profile: 'remote', run_id_prefix: 'remote' }),
  ];
  const before = computeSourceReliability(records);
  assert.equal(before.alerts.length, 0);
  assert.equal(before.sources.length, 2);

  const afterUnattempted = computeSourceReliability([...records]);
  assert.deepEqual(afterUnattempted, before);

  const after = computeSourceReliability([
    ...records,
    ...sourceRunSequence(['source_failure'], { profile: 'pt', run_id_prefix: 'pt-third', start_minute: 20 }),
  ]);
  assert.equal(after.alerts.length, 1);
  assert.equal(after.alerts[0].profile, 'pt');
});

test('reports newly active, active and resolved alert transitions', () => {
  const before = computeSourceReliability(sourceRunSequence([
    'zero_acquisition',
    'zero_acquisition',
    'zero_acquisition',
  ]));
  const newlyActive = compareSourceReliability(computeSourceReliability([]), before);
  assert.equal(newlyActive.newly_active.length, 1);
  assert.equal(newlyActive.active.length, 1);
  assert.equal(newlyActive.resolved.length, 0);

  const after = computeSourceReliability([
    ...sourceRunSequence(['zero_acquisition', 'zero_acquisition', 'zero_acquisition']),
    ...sourceRunSequence(['no_candidate_fit'], { run_id_prefix: 'recovery', start_minute: 20 }),
  ]);
  const resolved = compareSourceReliability(before, after);
  assert.equal(resolved.newly_active.length, 0);
  assert.equal(resolved.active.length, 0);
  assert.equal(resolved.resolved.length, 1);
  assert.equal(resolved.resolved[0].kind, 'zero_acquisition');
});

test('blocks every source row when a broad network outage classifies the environment as failed', () => {
  const sourceStats = Array.from({ length: 20 }, (_, index) => ({
    source: `Source ${index + 1}`,
    type: 'global',
    discovered: 0,
    accepted: 0,
    skipped: 0,
    error: index < 16 ? 'getaddrinfo ENOTFOUND jobs.example.test' : '',
  }));
  const batch = prepareSourceRunBatch(sourceBatchInput({ source_stats: sourceStats }));
  assert.equal(batch.environment.status, 'environment_failure');
  assert.equal(batch.records.length, 0);
  assert.match(batch.environment.reason, /16\/20/);
});

test('keeps small and HTTP failures source-specific instead of treating them as an environment outage', () => {
  const networkStats = Array.from({ length: 19 }, (_, index) => ({
    source: `Network ${index + 1}`,
    type: 'global',
    discovered: 0,
    accepted: 0,
    skipped: 0,
    error: 'connect ETIMEDOUT 203.0.113.10:443',
  }));
  const smallBatch = prepareSourceRunBatch(sourceBatchInput({ source_stats: networkStats }));
  assert.equal(smallBatch.environment.status, 'usable');
  assert.equal(smallBatch.records.length, 19);
  assert.ok(smallBatch.records.every((record) => record.outcome === 'source_failure'));

  const httpStats = Array.from({ length: 20 }, (_, index) => ({
    source: `HTTP ${index + 1}`,
    type: 'global',
    discovered: 0,
    accepted: 0,
    skipped: 0,
    error: 'HTTP 503 Service Unavailable',
  }));
  const httpBatch = prepareSourceRunBatch(sourceBatchInput({ source_stats: httpStats }));
  assert.equal(httpBatch.environment.status, 'usable');
  assert.equal(httpBatch.records.length, 20);
  assert.ok(httpBatch.records.every((record) => record.error_kind === 'server'));
});

test('aggregates quality and fit to the longest matching attempted source without storing vacancy data', () => {
  const batch = prepareSourceRunBatch(sourceBatchInput({
    source_stats: [
      { source: 'Acme', type: 'global', discovered: 1, accepted: 1, skipped: 0, skip_reasons: {}, error: '' },
      { source: 'Acme Portugal', type: 'portugal_priority', discovered: 2, accepted: 2, skipped: 0, skip_reasons: {}, error: '' },
      { source: 'Known Board', type: 'job_board', discovered: 2, accepted: 0, skipped: 2, skip_reasons: { known_url: 2 }, error: '' },
      { source: 'Broken Capture', type: 'job_board', discovered: 1, accepted: 0, skipped: 1, skip_reasons: { missing_link: 1 }, error: '' },
      { source: 'Empty Board', type: 'job_board', discovered: 0, accepted: 0, skipped: 0, skip_reasons: {}, error: '' },
    ],
    qualified_jobs: [
      { source: 'Acme careers_page', title: 'One', description: 'private JD must not persist' },
      { source: 'Acme Portugal greenhouse_api', title: 'Two', link: 'https://private.example/job/2' },
    ],
    selected_jobs: [
      { source: 'Acme Portugal greenhouse_api', title: 'Two', link: 'https://private.example/job/2' },
    ],
  }));

  assert.equal(batch.environment.status, 'usable');
  const bySource = Object.fromEntries(batch.records.map((record) => [record.source, record]));
  assert.equal(bySource.Acme.qualified, 1);
  assert.equal(bySource.Acme.selected, 0);
  assert.equal(bySource.Acme.outcome, 'no_candidate_fit');
  assert.equal(bySource['Acme Portugal'].qualified, 1);
  assert.equal(bySource['Acme Portugal'].selected, 1);
  assert.equal(bySource['Acme Portugal'].outcome, 'healthy');
  assert.equal(bySource['Known Board'].outcome, 'healthy');
  assert.equal(bySource['Broken Capture'].outcome, 'capture_gap');
  assert.equal(bySource['Empty Board'].outcome, 'zero_acquisition');
  assert.doesNotMatch(JSON.stringify(batch.records), /private JD|private\.example|title/i);
});

test('records only real canonical scans and keeps dry-run and replay inputs write-free', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-source-memory-boundary-'));
  const file = join(root, 'data', 'source-runs.tsv');
  const input = sourceBatchInput({
    project_root: root,
    source_stats: [{
      source: 'ITJobs.pt',
      type: 'job_board',
      discovered: 0,
      accepted: 0,
      skipped: 0,
      skip_reasons: {},
      error: '',
    }],
  });

  try {
    const dryRun = recordSourceRunMemory({ ...input, dry_run: true });
    assert.equal(dryRun.recorded, false);
    assert.equal(dryRun.reason, 'dry_run');
    assert.equal(fileExists(file), false);

    const replay = recordSourceRunMemory({ ...input, replay_input: true });
    assert.equal(replay.recorded, false);
    assert.equal(replay.reason, 'replay_input');
    assert.equal(fileExists(file), false);

    const live = recordSourceRunMemory(input);
    assert.equal(live.recorded, true);
    assert.equal(live.rows_recorded, 1);
    assert.equal(fileExists(file), true);
    assert.equal(parseSourceRunLedger(readFileSync(file, 'utf8')).records.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns alert transitions after an atomic write and sanitizes persistence failures', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-source-memory-transitions-'));
  const file = join(root, 'data', 'source-runs.tsv');
  const input = sourceBatchInput({
    project_root: root,
    source_stats: [{
      source: 'Empty Board',
      type: 'job_board',
      discovered: 0,
      accepted: 0,
      skipped: 0,
      skip_reasons: {},
      error: '',
    }],
  });

  try {
    recordSourceRunMemory({ ...input, timestamp: '2026-08-25T10:00:00.000Z', run_id: 'one' });
    recordSourceRunMemory({ ...input, timestamp: '2026-08-25T10:01:00.000Z', run_id: 'two' });
    const third = recordSourceRunMemory({ ...input, timestamp: '2026-08-25T10:02:00.000Z', run_id: 'three' });
    assert.equal(third.transitions.newly_active.length, 1);
    assert.equal(third.transitions.newly_active[0].kind, 'zero_acquisition');

    const previous = readFileSync(file, 'utf8');
    const failed = recordSourceRunMemory({
      ...input,
      timestamp: '2026-08-25T10:03:00.000Z',
      run_id: 'four',
    }, {
      atomicOptions: {
        renameFile() {
          const error = new Error('private path and detail must not escape');
          error.code = 'EACCES';
          throw error;
        },
      },
    });
    assert.equal(failed.recorded, false);
    assert.equal(failed.reason, 'persistence_error');
    assert.equal(failed.error_code, 'EACCES');
    assert.doesNotMatch(JSON.stringify(failed), /private path and detail/);
    assert.equal(readFileSync(file, 'utf8'), previous);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not create a ledger for an environment-wide failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-source-memory-outage-'));
  const sourceStats = Array.from({ length: 20 }, (_, index) => ({
    source: `Source ${index + 1}`,
    type: 'global',
    discovered: 0,
    accepted: 0,
    skipped: 0,
    error: index < 16 ? 'getaddrinfo ENOTFOUND jobs.example.test' : '',
  }));

  try {
    const result = recordSourceRunMemory(sourceBatchInput({ project_root: root, source_stats: sourceStats }));
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'environment_failure');
    assert.equal(fileExists(join(root, 'data', 'source-runs.tsv')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scan-and-rank marks dry and replayed inputs write-free while preserving live scan context', () => {
  const scan = {
    scanned_at: '2026-08-25T10:00:00.000Z',
    profile: 'pt',
    scan_mode: 'new-only',
    source_stats: [{ source: 'ITJobs.pt', type: 'job_board', discovered: 1, accepted: 1 }],
  };
  const qualified = [{ job: { source: 'ITJobs.pt' } }];
  const selected = [{ job: { source: 'ITJobs.pt' } }];

  const live = buildSourceRunMemoryInput('C:\\safe-root', scan, {}, qualified, selected);
  assert.equal(live.dry_run, false);
  assert.equal(live.replay_input, false);
  assert.equal(live.profile, 'pt');
  assert.equal(live.mode, 'new-only');
  assert.equal(live.qualified_jobs, qualified);
  assert.equal(live.selected_jobs, selected);

  assert.equal(buildSourceRunMemoryInput('C:\\safe-root', scan, { dryRun: true }, qualified, selected).dry_run, true);
  assert.equal(buildSourceRunMemoryInput('C:\\safe-root', scan, { snapshot: {} }, qualified, selected).replay_input, true);
  assert.equal(buildSourceRunMemoryInput('C:\\safe-root', scan, { candidates: [] }, qualified, selected).replay_input, true);
  assert.equal(buildSourceRunMemoryInput('C:\\safe-root', scan, { fromSnapshot: 'scan.json' }, qualified, selected).replay_input, true);
});

test('read-only source status degrades cleanly for missing data and keeps active alerts non-fatal', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-source-status-'));
  const file = join(root, 'data', 'source-runs.tsv');

  try {
    const missing = getSourceReliabilityStatus({ projectRoot: root });
    assert.equal(missing.status, 'no_data');
    assert.equal(missing.exit_code, 0);
    assert.match(formatSourceReliabilitySummary(missing), /no source-run data/i);

    appendSourceRunRecords(file, sourceRunSequence(['healthy']));
    const healthy = getSourceReliabilityStatus({ projectRoot: root });
    assert.equal(healthy.status, 'ok');
    assert.equal(healthy.exit_code, 0);

    appendSourceRunRecords(file, sourceRunSequence([
      'source_failure',
      'source_failure',
      'source_failure',
    ], { source: 'Broken Board', run_id_prefix: 'broken', start_minute: 20 }));
    const alerts = getSourceReliabilityStatus({ projectRoot: root });
    assert.equal(alerts.status, 'alerts');
    assert.equal(alerts.exit_code, 0);
    assert.match(formatSourceReliabilitySummary(alerts), /HIGH.*Broken Board/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source status fails health readability only for an incompatible schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'leagle-source-status-invalid-'));
  const file = join(root, 'data', 'source-runs.tsv');
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(file, 'timestamp\toutcome\n2026-08-25T10:00:00.000Z\thealthy\n', 'utf8');

  try {
    const result = getSourceReliabilityStatus({ projectRoot: root });
    assert.equal(result.status, 'invalid');
    assert.equal(result.exit_code, 1);
    assert.match(formatSourceReliabilitySummary(result), /incompatible/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function sourceRunRecord(overrides = {}) {
  return {
    timestamp: '2026-08-25T10:00:00.000Z',
    run_id: '2026-08-25T10:00:00.000Z',
    contract_version: '1',
    runner: 'scan-and-rank',
    profile: 'pt',
    mode: 'new-only',
    source: 'ITJobs.pt',
    source_type: 'job_board',
    outcome: 'healthy',
    discovered: 2,
    captured: 2,
    qualified: 1,
    selected: 1,
    error_kind: 'none',
    ...overrides,
  };
}

function sourceRunRow(record) {
  return SOURCE_RUNS_HEADER.trimEnd().split('\t').map((column) => record[column] ?? '').join('\t');
}

function sourceRunSequence(outcomes, options = {}) {
  const startMinute = Number(options.start_minute || 0);
  return outcomes.map((outcome, index) => {
    const timestamp = `2026-08-25T10:${String(startMinute + index).padStart(2, '0')}:00.000Z`;
    return sourceRunRecord({
      timestamp,
      run_id: `${options.run_id_prefix || 'run'}-${startMinute + index}`,
      profile: options.profile || 'pt',
      source: options.source || 'ITJobs.pt',
      outcome,
      discovered: outcome === 'zero_acquisition' || outcome === 'source_failure' ? 0 : 1,
      captured: outcome === 'healthy' || outcome === 'no_candidate_fit' ? 1 : 0,
      qualified: outcome === 'healthy' || outcome === 'no_candidate_fit' ? 1 : 0,
      selected: outcome === 'healthy' ? 1 : 0,
      error_kind: outcome === 'source_failure' ? 'network' : 'none',
    });
  });
}

function pickAlert(alert) {
  return {
    kind: alert.kind,
    severity: alert.severity,
    streak: alert.streak,
  };
}

function sourceBatchInput(overrides = {}) {
  return {
    timestamp: '2026-08-25T10:00:00.000Z',
    run_id: '2026-08-25T10:00:00.000Z',
    runner: 'scan-and-rank',
    profile: 'pt',
    mode: 'new-only',
    source_stats: [],
    qualified_jobs: [],
    selected_jobs: [],
    ...overrides,
  };
}

function fileExists(file) {
  try {
    readFileSync(file, 'utf8');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
