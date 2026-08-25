# Current Leagle Job Status

Last reconciled: 2026-08-25

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
- Atomic source-health replacement with an environment-failure guard. A broad
  network outage cannot replace the last usable canonical source snapshot.
- Atomic, sanitized per-source run memory for real canonical scans. It keeps
  acquisition, capture, quality and fit separate; alerts after three
  comparable failures or empty acquisitions; and advances no source streak
  during a broad environment outage.
- Optional Codex/Gmail integration. When explicitly enabled and every gate
  passes, it may create an unsent Gmail draft with its deterministic local CV
  attachment. It never sends email or submits an application.
- Optional portal preparation may fill only confirmed fields and stops before
  file upload or final submission.

## Current validation evidence

The local release candidate was last checked on 2026-08-25 with:

| Gate | Result |
| --- | --- |
| Node unit suite | 144 passing, 0 failing |
| Product health | 16/16 checks passing |
| Product suite | 101 passing, 0 failing, 0 warnings |
| Pipeline reconciliation | 0 errors, 0 warnings across 137 tracker entries |
| Dependency audit | 0 production vulnerabilities reported |
| Secret scan | 24 reachable Git commits scanned with no leaks |
| Whitespace check | no whitespace errors |

These results prove the local deterministic checks. They do not prove that
external job boards, Codex authentication, a Gmail connector or a browser
session are available at a later time.

## Operational limits

- Discovery coverage is **DEGRADED** until a current coverage audit proves
  otherwise. A configured source is not evidence that it produced a valid job.
- Persistent source-run memory currently covers only the canonical
  `scan-and-rank` path. Structured deep search and browser/manual imports stay
  excluded until they expose the same acquisition/capture/fit contract.
- LinkedIn, Indeed and IEFP are not all first-class executable Node scanners;
  use authenticated/manual discovery only as supplemental, user-controlled
  input and verify the official vacancy before any action.
- The operational store is currently Markdown, TSV and JSONL. Source-health
  replacement is atomic; the remaining stores have integrity checks but no
  transaction spanning every file write.
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

1. Restore measurable discovery coverage across LinkedIn, Indeed, IEFP Online,
   ITJobs and Net-Empregos. Preserve the discovery lane separately, then
   verify the official vacancy before any dashboard write.
2. Dogfood the new source-run memory in real Portugal-first scans and adjust
   thresholds only from observed noise; zero acquisition remains a coverage
   warning, not proof of a broken portal.
3. Normalize acquisition/capture/fit counters in structured deep search and
   other scanners before allowing them to write the same ledger.
4. Preserve exact official vacancy titles through evaluation and dashboard
   import so a trustworthy listing remains recognisable to the candidate.
5. Extend the tested atomic persistence boundary one store at a time before
   considering any database migration or additional automation.
