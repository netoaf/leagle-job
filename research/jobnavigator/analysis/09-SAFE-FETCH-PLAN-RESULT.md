# Safe-Fetch Foundation Plan and Result

Execution date: 2026-07-23

## Decision

The first post-intake plan was deliberately limited to JobFinder's outbound
network boundary. No JobNavigator adapter or source code was imported.

Result: **implementation pass; release remains blocked by a pre-existing Git
privacy/index violation.**

## Validated plan

1. Revalidate JobFinder rules, dirty worktree and health baseline.
2. Map direct HTTP and Playwright navigation points.
3. Resolve the pre-existing health failure according to the documented scoring
   contract.
4. Implement an independent JobFinder-native safe HTTP transport.
5. Migrate direct consumers and add a Playwright network guard.
6. Run offline security tests, a synthetic public live check and full product
   gates.
7. Record residual risks and stop before importing an ATS adapter.

The implementation was based on the OWASP SSRF guidance and the official
Node.js DNS/HTTP APIs listed in `career-ops-main/career-ops-main/docs/network-safety.md`.

## Health baseline correction

`examples/jobs/maybe-support-role.yml` had been changed to expect `discard`,
while:

- `docs/scoring-system.md` says the fixture must return `maybe`;
- `config/scoring.yml` treats missing mentorship as a penalty, not a hard
  blocker;
- the engine returned `maybe` at 68/100.

The expected result was restored to `maybe`. No scoring weight, threshold,
candidate profile or personal rule was changed. Health then passed 13/13
before the network implementation began.

## Implemented boundary

New modules:

- `lib/network/safe-fetch.mjs`
- `lib/network/playwright-guard.mjs`
- `tests/safe-fetch.test.mjs`
- `docs/network-safety.md`

Key controls:

- standard URL parsing; HTTP(S) only;
- optional HTTPS and hostname allowlists;
- GET, HEAD and POST only;
- ports 80/443 by default;
- URL credentials and caller-controlled Host headers rejected;
- all A/AAAA results checked; one non-public result rejects the host;
- loopback, private, link-local, CGNAT, multicast, reserved, documentation and
  special IPv6 ranges blocked;
- connection lookup pinned to the validated IP to close the Node DNS
  validation/connection gap;
- every redirect revalidated;
- HTTPS-to-HTTP downgrade blocked;
- sensitive headers stripped across origins;
- redirect, timeout, request-byte, response-byte and header budgets;
- WebSockets blocked in Playwright;
- service workers disabled in Playwright contexts;
- initial and intercepted browser URLs validated.

## Migrated consumers

- `scan-jobs.mjs`
- `lib/job-description-extractor.mjs`
- `portal-audit.mjs`
- `open-job-board-search.mjs`
- `net-empregos-search.mjs`
- `structured-deep-search.mjs`
- `browser-use-jobs.mjs`
- `update-system.mjs`
- `lib/browser-agent/playwright-agent.mjs`
- `check-liveness.mjs`

Static search found zero remaining direct global `fetch()` calls in JobFinder
`.mjs` code. The four Playwright navigation implementations are routed through
the new validation/guard layer.

## Verification results

- Safe-fetch offline tests: 17/17 pass.
- Syntax checks for all changed modules: pass.
- Public synthetic transport check: HTTPS `example.com`, HTTP 200, 559 bytes,
  no redirect, no credentials.
- `npm run verify`: pass with the original 45 application entries, zero errors
  and zero warnings.
- `npm run jobfinder:health`: pass, 14/14 checks.
- The network test is now a mandatory health check.
- No new runtime dependency was installed or added.
- No personal file was intentionally edited by the implementation.

## Test-harness correction

`test-all.mjs` previously:

- scanned the bundled Go SDK under `tools/`, causing false personal-data and
  absolute-path findings;
- executed normalization and deduplication in write mode.

It now excludes the bundled toolchain from first-party source scans and runs
normalization, deduplication and merge checks with `--dry-run`.

During discovery, the old test removed one duplicate row from
`data/applications.md`. The tracker was restored byte-for-byte from its
pre-test backup to 45 entries, and a second test run confirmed its SHA-256 did
not change.

## Remaining blocker

`test-all.mjs --quick` now produces 77 passes, 3 failures and 0 warnings. The
only failures are real and pre-existing:

- `config/profile.yml`
- `modes/_profile.md`
- `portals.yml`

They are listed in `.gitignore` but remain tracked in the initial Git snapshot.
Fixing the current index is recoverable, but removing personal material from
existing Git history may require a history rewrite and remote coordination.
That action is outside this network plan and must not be performed silently.

## Residual browser limitation

Node HTTP connections are pinned to the validated IP. Chromium performs its
own socket resolution, so the Playwright guard cannot provide identical
connection-level pinning. Playwright remains a controlled fallback with
initial/per-request validation, WebSockets blocked, service workers disabled,
no login and human review.

## Next professional gate

Before an Oracle HCM or other ATS adapter is promoted, execute a separate
privacy/Git-index plan for the three tracked user-layer files. After that gate
is green, Oracle HCM is the first recommended adapter plan.
