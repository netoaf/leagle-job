# Architecture

Leagle Job, based on Career-Ops, is a local-first job-search pipeline. It discovers jobs,
deduplicates them, extracts job descriptions, scores them against the candidate
profile, writes reports, shows the pipeline in a terminal dashboard and prepares
review-ready application material.

It never sends applications or email, and it never uploads CVs automatically.
When explicitly enabled, the optional integration layer can prepare confirmed
portal fields and create an unsent Gmail draft; both flows stop before upload,
send or final submission.

See [`CURRENT-STATUS.md`](CURRENT-STATUS.md) for the verified release baseline,
decision precedence and current engineering gate.

## System Overview

```text
configured sources + job boards
  -> scan-jobs.mjs
  -> normalize + dedupe
  -> optional browser/max extraction
  -> quality gate
  -> job-scoring-service.mjs
  -> scan-and-rank.mjs
  -> atomic source-run memory (real canonical scans only)
  -> report + tracker + job index + scan history
  -> dashboard TUI
  -> application packs / CV tailoring diffs / follow-up tracking
```

## Source Of Truth

- `config/profile.yml`: candidate identity, target roles and confirmed skills.
- `config/candidate-context.yml`: reusable positioning, evidence and messaging.
- `data/candidate-evidence.md`: human-readable evidence bank.
- `config/scoring.yml`: scoring weights, thresholds, blockers and penalties.
- `config/jobfinder-rules.yml`: privacy, anti-invention and approval rules.
- `config/quality-gate.yml`: minimum data quality before scoring.
- `portals.yml`: job boards, search queries and tracked companies.

Anything not confirmed in these files must remain `a confirmar`.

## Discovery Flow

```text
portals.yml / job boards
  -> scan-jobs.mjs
  -> source adapters
  -> data/job-index.jsonl
  -> data/scan-history.tsv
```

Supported source patterns include generic HTML, Greenhouse, Ashby, Lever,
Landing.jobs, Workday, Teamtailor, Workable, SmartRecruiters, Eightfold and
safe browser extraction for selected pages.

## Source Reliability Memory

Three local stores answer different questions:

- `data/source-health.tsv`: the latest explicit reachability/configuration
  audit for configured company sources.
- `data/source-runs.tsv`: append-only, sanitized counters for comparable real
  `scan-and-rank` source attempts.
- `data/scan-history.tsv`: captured vacancy URLs used by dedupe and recent
  coverage reporting.

`data/source-runs.tsv` separates acquisition, usable capture, quality and fit.
It records only the source name/type, scan profile/mode, bounded counters,
outcome and a coarse error kind. It never stores raw errors, URLs, vacancy
text, candidate data or credentials. The comparison key includes the contract
version, runner, profile, mode, source type and source name.

After three consecutive comparable source failures, the read-only status
command shows a high-severity alert. Three successful but empty acquisitions
produce a medium warning; this means "check coverage or current openings", not
"the source is broken". A source that returns jobs with no candidate fit is
informational and resets both streaks.

Dry-run and snapshot/candidate re-ranking never write this ledger. A broad
environment failure (at least 20 attempted sources and at least 80% network
transport failures) writes no per-source rows, so one local outage cannot turn
into hundreds of false source failures. Ledger replacement is atomic; a failed
write preserves the previous bytes.

## Evaluation Flow

```text
job object
  -> normalizeJob
  -> enrichJob
  -> quality gate
  -> evaluateJobFit
  -> report + dashboard row
```

The deterministic scoring service returns a 0--100 result across seven
dimensions: role fit, technical stack, mentorship/learning, progression,
location/work mode, compensation and clarity/credibility. It returns:

- score;
- recommendation;
- score breakdown;
- strengths;
- red flags;
- hard blockers;
- reasoning;
- next action.

Hard blockers can force `discard` even when the numeric score is high.

## Dashboard

The Go dashboard reads:

- `data/applications.md`;
- `reports/*.md`;
- `data/application-actions.tsv`;
- `data/application-followups.tsv`.

It provides:

- grouped/flat views;
- filters by status and top scores;
- report viewer with text wrapping;
- URL opening;
- status changes;
- automatic refresh;
- follow-up preview;
- local Leagle Job actions, including guarded Gmail/portal preparation when
  those integrations are available.

Dashboard actions are local commands. Preview actions do not write dashboard
rows. Actions that would create an unsent Gmail draft or prepare a portal are
fail-closed and require their own preflight evidence; none can send, upload or
submit.

## Application Material

The application layer is review-first:

- `application-pack.mjs`: creates application packs.
- `top10-action-mode.mjs`: creates a Top 10 action plan and packs.
- `cv-tailor-diff.mjs`: creates safe CV tailoring diffs without editing CVs.
- `draft-quality-gate.mjs`: validates email drafts before use.
- `gmail-adapter.mjs` and `gmail-sync.mjs`: optional gated draft creation and
  read-only Gmail event import.
- `prepare-portal-application.mjs`: optional confirmed-field preparation only.
- `follow-up-tracker.mjs`: lists and initializes follow-up rows.

No material is considered ready until reviewed by a human.

## Follow-Up Tracking

Follow-up metadata lives in:

```text
data/application-followups.tsv
```

The dashboard updates this file when statuses change. For example, marking a
job as `Applied` creates an applied date and a follow-up date seven days later.

## Safety Model

The system must not:

- invent candidate data;
- present the candidate as mid-level or senior;
- expose private code or private links;
- store API keys in the repository;
- submit forms;
- send emails;
- upload CVs automatically.

All direct HTTP(S) requests made by Leagle Job scripts pass through
`lib/network/safe-fetch.mjs`. The boundary rejects local/private addresses,
pins the Node connection to a validated public DNS result, revalidates
redirects and enforces request, response, redirect, port and timeout budgets.
Playwright fallbacks use the companion network guard, block WebSockets and run
with service workers disabled. See `docs/network-safety.md`.

The tool prepares, ranks and organizes. The final application decision remains
human.
