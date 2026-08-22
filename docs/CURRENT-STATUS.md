# Current Leagle Job Status

Last reconciled: 2026-08-22

## Scope of this document

This is the concise status of the checked-in product. It intentionally does not
contain candidate names, recruiter addresses, vacancy lists, tracker IDs,
private reports or operational audit detail. Those belong to the local User
Layer and must not be included in a release.

The public `main` history is behind the local baseline candidate described
here. Do not infer that a public GitHub commit, tag or CI run includes a feature
unless that exact revision contains it.

## Confirmed product capabilities

- Local-first Node.js job-discovery and ranking pipeline with a Go terminal
  dashboard.
- Source adapters for supported job boards, ATS platforms and bounded generic
  HTML extraction; browser extraction is optional and guarded.
- Evidence-preserving normalization, multi-key deduplication, quality gate and
  deterministic 0--100 scoring.
- Human-readable reports, application packs, CV selection, application-action
  tracking and follow-up tracking.
- Network safety boundary for direct HTTP and browser fallback, including
  public-address checks, redirect revalidation and response budgets.
- Repeatable redacted full-history secret scan through the locally ignored
  Gitleaks binary or an explicitly configured executable.
- Optional Codex/Gmail integration. When explicitly enabled and every gate
  passes, it may create an unsent Gmail draft with its deterministic local CV
  attachment. It never sends email or submits an application.
- Optional portal preparation may fill only confirmed fields and stops before
  file upload or final submission.

## Current validation evidence

The local baseline candidate was last checked on 2026-08-22 with:

| Gate | Result |
| --- | --- |
| Node unit suite | 114 passing, 0 failing |
| Product health | 15/15 checks passing |
| Pipeline reconciliation | 0 errors, 0 warnings across 126 tracker entries |
| Dependency audit | no known production vulnerabilities reported |
| Secret scan | redacted full Git history scan passed with no leaks |
| Whitespace check | no whitespace errors; some CRLF/LF normalization warnings remain |

These results prove the local deterministic checks. They do not prove that
external job boards, Codex authentication, a Gmail connector or a browser
session are available at a later time.

## Operational limits

- Discovery coverage is **DEGRADED** until a current coverage audit proves
  otherwise. A configured source is not evidence that it produced a valid job.
- LinkedIn, Indeed and IEFP are not all first-class executable Node scanners;
  use authenticated/manual discovery only as supplemental, user-controlled
  input and verify the official vacancy before any action.
- The operational store is currently Markdown, TSV and JSONL. It has integrity
  checks but no database transaction spanning every file write.
- Core search, ranking, dashboard and tracking work without Codex. Advanced
  Gmail drafting and portal preparation require a compatible authenticated
  Codex/browser environment and fail closed when it is unavailable.

## Canonical references

- Product architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- User/system data boundary: [`../DATA_CONTRACT.md`](../DATA_CONTRACT.md)
- Daily operation: [`operational-runbook.md`](operational-runbook.md)
- Gmail boundary: [`gmail-adapter.md`](gmail-adapter.md)
- Agent routing: [`CODEX.md`](CODEX.md)

## Next engineering priorities

1. Build and independently validate a sanitized local release package from
   this checked-out baseline; do not infer public GitHub parity before that
   package is intentionally published.
2. Make source health and market-coverage evidence explicit in the daily
   workflow, then repair only verified high-value Portugal-first source URLs.
3. Introduce an atomic persistence boundary before any future database
   migration or additional automation.
