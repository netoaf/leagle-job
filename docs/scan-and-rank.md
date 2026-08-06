# Leagle Job Scan-And-Rank

This document explains the automatic discovery and ranking workflow added to
Leagle Job.

## What It Does

`scan-and-rank` turns Leagle Job into a repeatable pipeline:

1. Scan public job sources.
2. Normalize job data into a consistent object.
3. Enrich each job with canonical URL, external ID, seniority and metadata.
4. Deduplicate against `data/job-index.jsonl`, `data/scan-history.tsv`,
   `data/pipeline.md`, reports and `data/applications.md`.
5. Run the quality gate from `config/quality-gate.yml`.
6. Score each valid job with `job-scoring-service.mjs`.
7. Select only jobs above the configured threshold.
8. Generate a report and email draft.
9. Add selected jobs to `data/applications.md`, which the dashboard reads.

It does not submit applications, send emails, fill forms or expose private
code. The candidate must approve any application manually.

## Main Commands

Preview scanner results without writing files:

```bash
npm run scan:dry-run -- --limit 10
```

Evaluate one job URL safely:

```bash
npm run evaluate-url -- --url "https://example.com/job"
npm run evaluate-url -- --url "https://example.com/job" --write --dashboard
```

Preview ranked results without writing reports or dashboard entries:

```bash
npm run rank:dry-run -- --limit 10
```

Recommended full Leagle Job preview:

```bash
npm run jobfinder:dry-run -- --limit 30
```

Recommended new-only preview:

```bash
npm run jobfinder:new:dry-run -- --limit 80
```

Write only new selected jobs to the dashboard:

```bash
npm run jobfinder:new -- --limit 80 --write-limit 5
```

Deep Portugal-first scan with sensible defaults:

```bash
npm run jobfinder:deep:dry-run
npm run jobfinder:deep
```

Audit mode intentionally includes known/seen jobs:

```bash
npm run jobfinder:audit:dry-run -- --limit 80
```

Refresh mode revisits known jobs for review without changing the default
new-only workflow:

```bash
npm run jobfinder:refresh:dry-run -- --limit 80
```

Equivalent explicit Portugal-first preview:

```bash
npm run jobfinder:pt:dry-run -- --limit 30
```

Scan only ITJobs.pt:

```bash
npm run rank:dry-run -- --source ITJobs --limit 10
```

Write selected jobs to the dashboard:

```bash
npm run rank -- --source ITJobs --limit 10
```

Equivalent shortcut:

```bash
npm run jobfinder -- --source ITJobs --limit 10
```

Full automatic run with Portugal-first priority:

```bash
npm run jobfinder -- --limit 30
```

Safer focused write mode:

```bash
npm run jobfinder:pt -- --limit 30 --write-limit 5
```

Validate the tracker afterwards:

```bash
npm run verify
```

Audit configured career sources:

```bash
npm run portals:audit
```

## Current Sources

The scanner currently supports:

- ITJobs.pt structured job pages.
- Landing.jobs job pages and company pages.
- Noesis/Bizneo career cards.
- Greenhouse API boards when `api:` is configured in `portals.yml`, plus
  automatic API discovery for Greenhouse board URLs.
- Ashby hosted job boards via `window.__appData`.
- Lever hosted job boards via posting blocks.
- Teamtailor career pages when `adapter: teamtailor` is configured.
- Workable hosted/custom career pages when `adapter: workable` is configured,
  using public `jobs.md`/`llms.txt` metadata when available.
- Workday CXS APIs when a `api: .../wday/cxs/.../jobs` endpoint is configured.
- Eightfold career pages when `adapter: eightfold` is configured, using a
  bounded rendered listing and the same-origin public job-detail API.
- Browser-rendered career pages when `adapter: browser` is configured.
- Single job pages that require rendered extraction when
  `adapter: browser_agent` is configured.
- Public company career pages configured in `portals.yml`.

Company pages are useful, but often noisy. The scoring layer is expected to
discard broad developer roles that are not junior/internship-friendly.

The default scan uses the `pt` profile from:

```text
config/scan-profiles.yml
```

That profile has quotas per source group. It searches Portugal-relevant boards
and companies first and does not fall through into broad global companies by
accident.

Each profile can also set `per_company_quota`. This prevents one company with
many matching openings from filling the whole scan limit before the scanner
checks the next websites.

Individual sources can set `scan_pages` when a browser-rendered listing uses
simple `?page=N` pagination.

Eightfold sources use interactive pagination internally. Their `scan_pages`
value is clamped to `1-5`; job-detail requests are made only for titles that
pass the configured positive/negative filter.

For one-off vacancies or JavaScript-heavy pages where normal HTML fetch misses
the description, prefer:

```bash
npm run evaluate-url -- --url "https://example.com/job"
```

If a tracked source must use the safe browser agent inside the scanner, configure
it explicitly:

```yaml
tracked_companies:
  - name: Example Company
    careers_url: https://example.com/jobs/junior-developer
    adapter: browser_agent
    enabled: true
```

This adapter is extraction-only. It does not click apply buttons, fill forms,
upload CVs or send emails.

Available profiles:

- `pt`: Portugal-first junior/internship scan. Default.
- `remote`: remote/Europe scan for broader opportunities.
- `global`: broad scan across configured sources. Higher noise.

## Useful Options

- `--dry-run`: no reports, no dashboard writes, no scan-history writes.
- `--limit N`: maximum number of discovered candidates to process.
- `--profile pt|remote|global`: choose the scan profile.
- `--source NAME`: scan one source/company, for example `ITJobs` or `Noesis`.
- `--min-score N`: override the minimum score needed to write a job.
- `--new-only`: explicit normal mode. Skips known URLs, external IDs,
  fingerprints and company/role matches.
- `--audit`: intentionally includes known jobs. Use this only to review or
  debug scoring.
- `--refresh-known`: intentionally revisits known jobs. Use this for liveness
  or status review, not for daily discovery.
- `--include-seen`: include URLs already seen before.
- `--write-limit N`: cap how many selected jobs are written in one run.
- `--no-job-boards`: skip broad portal scans and only scan companies in
  `portals.yml`.
- `--write-guard-mode dashboard_only`: advanced recovery mode for promoting a
  previously skipped false negative. It still blocks existing dashboard/report
  duplicates, but ignores old scan-history/index skips.

## Dedupe Model

Leagle Job now uses a technical index:

```text
data/job-index.jsonl
```

Each record stores the best known identity for a vacancy:

- canonical URL without tracking parameters
- external job ID when a platform exposes one
- normalized company/title/location fingerprint
- company/role fallback key
- source, status, first seen and last seen metadata

This means a vacancy can be skipped even when it appears through a different
portal URL, as long as the company/title/location or external ID matches.
`data/scan-history.tsv` stays as the human-readable history.

## Quality Gate

Before scoring, each job must pass `config/quality-gate.yml`.

The gate blocks jobs that are missing critical data, inactive, scam-like,
clearly non-technical, generic technical roles without junior/mentorship
signals, or experience-heavy roles without a junior/internship signal. It warns
on weaker data such as missing compensation, unclear seniority or thin
descriptions.

The report includes a `Data Quality` section with:

- missing fields
- warnings
- description length
- fingerprint

Jobs rejected by the quality gate are written to history during real runs so
they do not keep appearing as new.

## Reading The Output

The command prints `Source diagnostics` after each scan. Each line means:

- `found`: matching jobs extracted from that website before final dedupe.
- `accepted`: new jobs kept for scoring.
- `skipped`: jobs ignored because they were duplicates, inactive or missing a
  usable link.
- `ERROR`: the source was attempted but could not be fetched or parsed.

If `accepted` is low but `skipped` is high, the scanner is mostly seeing jobs
already known from `data/job-index.jsonl`, `data/scan-history.tsv`,
`data/pipeline.md`, reports or `data/applications.md`. Use `--audit` or
`--include-seen` only for debugging; normal runs should keep dedupe on.

`scan-and-rank` also prints compact summaries:

- `Quality rejection summary`: jobs rejected before scoring because critical
  data is missing, the role is expired, non-technical, scam-like or too weak for
  ranking.
- `Scanner skip summary`: jobs skipped during discovery, usually because they
  are already known, duplicated in the same run, inactive or missing a usable
  link.
- `Fit rejection summary`: jobs that were good enough to score but then became
  `discard` or fell below the minimum score.

This is the fastest way to see whether the tool is really finding new jobs or
mostly re-seeing the same market from different websites.

For source-level problems such as dead URLs, blocked pages or missing adapters,
run `npm run portals:audit`. See [source-health.md](source-health.md).

## Dashboard Refresh

The live dashboard reads `data/applications.md` and refreshes automatically.
When `scan-and-rank` writes a selected job, it appears in the dashboard without
needing a manual restart.

Manual refresh is still available with `r` inside the dashboard.

Before writing a selected job, `scan-and-rank` checks the technical job index,
known URLs in `data/scan-history.tsv`, `data/pipeline.md` and `reports/`, plus
company/role pairs in `data/applications.md`. This prevents duplicate
dashboard entries even when audit mode is used.

## Safety Rules

The scan-and-rank workflow must obey:

- Do not invent experience, certificates, metrics, clients, links or projects.
- Mark unknown details as `a confirmar`.
- Keep the candidate positioned as junior/internship.
- Do not expose private code, tokens, API keys or private links.
- Do not send applications or emails automatically.
- Always review generated reports and drafts before contacting a company.
