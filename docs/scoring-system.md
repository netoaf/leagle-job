# Leagle Job Scoring System

This document explains the structured scoring layer used by Leagle Job.

## Source Files

Leagle Job uses three config files as the main source of truth:

- `config/profile.yml` - candidate identity, targets, skills, projects and preferences.
- `config/scoring.yml` - score scale, weights, thresholds, hard blockers, red flag penalties and required output fields.
- `config/jobfinder-rules.yml` - critical no-invention, privacy, language and approval rules.

Evaluation code lives in:

- `job-scoring-service.mjs`
- `lib/config-loader.mjs`
- `scan-and-rank.mjs` for automatic scan results

## Score Scale

The score is from `0` to `100`.

The dimensions and weights are defined in `config/scoring.yml`:

- `target_role_fit`
- `technical_stack`
- `mentorship_learning`
- `progression`
- `location_remote`
- `compensation`
- `clarity_credibility`

The weights must always sum to `100`. If they do not, validation fails.

## Recommendation Thresholds

Recommendations come from `config/scoring.yml`:

- `apply`: score is greater than or equal to `apply_min`.
- `maybe`: score is greater than or equal to `maybe_min` but below `apply_min`.
- `discard`: score is below `discard_below`, or a hard blocker is triggered.

Hard blockers override the raw score. A role can look acceptable numerically and
still become `discard` if it is unsafe, misleading or not technical.

## Red Flags

Red flags are warning signals that reduce the score.

Examples:

- junior/internship role asking for 2+ years
- no salary or stipend
- no mentorship
- unclear stack
- sales disguised as IT
- far onsite location
- vague description
- mandatory certification the candidate does not have
- required language that is not confirmed in `config/profile.yml`
- suspicious company presence

Penalty values are defined in `config/scoring.yml` under
`red_flag_penalties`.

## Hard Blockers

Hard blockers force `recommendation: discard` when severe.

Examples:

- `scam_or_mlm`
- `sales_disguised_as_it`
- `non_technical_role`
- `senior_required`
- `private_data_required`
- `fake_junior_role`

These prevent the system from recommending risky or misleading opportunities.

## Required Output

Every vacancy report should include the fields listed in:

```text
config/scoring.yml -> output_required_fields
```

This keeps evaluations consistent across manual review, reports, generated CVs
and the dashboard/tracker flow.

## Validation

Run:

```bash
npm run validate-config
```

This checks:

- weights sum to `100`
- thresholds are between `0` and `100`
- hard blockers are not empty
- output required fields are not empty
- critical rules and privacy rules exist

The regular sync check also validates these configs:

```bash
npm run sync-check
```

## Example Jobs

Example fixtures live in:

```text
examples/jobs/
```

Run:

```bash
npm run test-scoring
```

Current fixtures:

- `examples/jobs/good-internship.yml` should return `apply`
- `examples/jobs/maybe-support-role.yml` should return `maybe`
- `examples/jobs/bad-sales-scam.yml` should return `discard`

To score one file manually:

```bash
node job-scoring-service.mjs examples/jobs/good-internship.yml
```

## Automatic Scan-And-Rank

The automatic workflow uses the same scoring rules:

```bash
npm run jobfinder:new:dry-run -- --limit 80
npm run jobfinder:new -- --limit 80 --write-limit 5
```

Dry-run previews enrichment, dedupe, quality gate and ranking only. The real
command writes selected jobs to `data/applications.md`, updates
`data/job-index.jsonl`, updates `data/scan-history.tsv` and creates reports in
`reports/`.

More details:

```text
docs/scan-and-rank.md
```

## Editing Weights

To change weights:

1. Edit `config/scoring.yml`.
2. Keep the total at `100`.
3. Run `npm run validate-config`.
4. Run `npm run test-scoring`.
5. Review at least one real vacancy before trusting the new scoring behavior.

Do not put candidate-specific scoring rules in generic mode files. Keep them in
`config/scoring.yml` and `modes/_profile.md`.

## Safety Rules

The scoring layer does not replace human approval.

Leagle Job must never:

- invent experience, projects, certificates, metrics, links or clients
- expose private code, private links, API keys, tokens or sensitive data
- present a junior/intern candidate as mid-level or senior
- send applications or emails without approval
