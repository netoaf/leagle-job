# Architecture

Leagle Job, based on Career-Ops, is a local-first job-search pipeline. It discovers jobs,
deduplicates them, extracts job descriptions, scores them against the candidate
profile, writes reports, shows the pipeline in a terminal dashboard and prepares
review-ready application material.

It does not send applications, send emails, fill forms or upload CVs.

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
  -> reports/*.md
  -> data/applications.md
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

## Evaluation Flow

```text
job object
  -> normalizeJob
  -> enrichJob
  -> quality gate
  -> evaluateJobFit
  -> report + dashboard row
```

The scoring service returns:

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
- `data/application-followups.tsv`.

It provides:

- grouped/flat views;
- filters by status and top scores;
- report viewer with text wrapping;
- URL opening;
- status changes;
- automatic refresh;
- follow-up preview;
- local Leagle Job actions through the `a` key.

Dashboard actions are local commands. Preview actions do not write dashboard
rows. Write actions are clearly marked and require confirmation.

## Application Material

The application layer is review-first:

- `application-pack.mjs`: creates application packs.
- `top10-action-mode.mjs`: creates a Top 10 action plan and packs.
- `cv-tailor-diff.mjs`: creates safe CV tailoring diffs without editing CVs.
- `draft-quality-gate.mjs`: validates email drafts before use.
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
