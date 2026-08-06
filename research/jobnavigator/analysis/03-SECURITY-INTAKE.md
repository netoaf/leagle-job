# Static Security and Supply-Chain Intake

Target revision:
`387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`

Assessment date: 2026-07-23

## Verdict

**Static analysis may continue. Runtime execution with real data is not
approved. Integration into JobFinder is not approved.**

The repository contains useful engineering work and several positive security
controls, but its current trust, privacy and supply-chain posture is below the
required baseline for JobFinder.

## Critical finding

### SEC-001 — Tailoring prompt explicitly permits invented facts and metrics

- Severity: Critical for JobFinder integration
- Evidence: `backend/seed.py`, `persona_tailor_prompt`
- Behavior: `suggested_bullets` are instructed to invent plausible facts and
  metrics for the user to accept or reject.
- Conflict: JobFinder forbids invented experience, results, skills, claims and
  metrics at every stage, including drafts.
- Decision: reject the upstream scoring/tailoring prompt and all downstream
  logic that assumes invented gap-fillers are acceptable.

## High findings

### SEC-002 — Chrome extension removes browser security headers globally

- Evidence: `extension/background.js`, `extension/manifest.json`
- Permissions: `<all_urls>`, `declarativeNetRequest`, scripting and storage.
- Behavior: session rules remove `X-Frame-Options` and
  `Content-Security-Policy` from main frames and subframes for all URLs.
- Decision: reject this extension implementation. A future JobFinder capture
  extension must use minimal host permissions and must never strip security
  headers.

### SEC-003 — Secrets are stored in plaintext in multiple locations

- Evidence: `SECURITY.md`, `backend/models/db.py`,
  `backend/api/routes_settings.py`, `frontend/src/api.js`,
  `extension/popup.js`
- Database settings can contain LLM keys, Gmail refresh tokens, Telegram
  tokens, LinkedIn/Jobright credentials and the dashboard key in plaintext.
- The dashboard key is also stored in browser `localStorage`; the extension
  stores its API key in Chrome sync storage.
- Database backups therefore contain plaintext secrets.
- Decision: no real credentials may be used in any research environment.

### SEC-004 — Weak first-run and network exposure defaults

- Evidence: `backend/config.py`, `backend/main.py`, `.env.example`,
  `docker-compose.yml`, `Caddyfile`
- `INITIAL_API_KEY` defaults to the predictable value
  `change-me-on-first-login`, while empty database state can activate a
  first-run auth bypass.
- The README/login text and runtime defaults are inconsistent about whether
  blank login is expected.
- Backend and frontend ports are bound without `127.0.0.1`; Caddy exposes ports
  80/443. The session cookie is set with `secure=False`.
- Swagger/OpenAPI, tracer redirects and Telegram webhook are public routes.
- Decision: do not start the provided Compose stack unchanged.

### SEC-005 — Non-reproducible and high-risk build inputs

- Evidence: `Dockerfile.backend`, `Dockerfile.frontend`,
  `backend/requirements.txt`, `.github/workflows/ci.yml`
- No frontend lockfile is tracked; the build uses `npm install`.
- Container bases use mutable tags rather than digests.
- Backend build pipes a downloaded NodeSource script into `bash`.
- It globally installs unversioned `@anthropic-ai/claude-code`.
- Python requirements have versions but no hashes; one dependency is sourced
  from the maintainer's GitHub fork at a commit SHA.
- GitHub Actions are referenced by mutable major tags instead of commit SHAs.
- Dependency audit is non-blocking and explicitly ignores a known markdownify
  CVE.
- Decision: do not build upstream images until an isolated execution plan pins
  inputs and removes unnecessary tooling.

### SEC-006 — SSRF control is strong but not consistently applied

- Positive helper: `backend/scraper/_shared/url_safety.py` validates schemes,
  DNS results, private/link-local/CGNAT ranges and every redirect hop.
- Tests cover metadata endpoints, private IPs, mixed DNS and redirect chains.
- Coverage gap: the helper is used mainly in application page caching and
  description extraction; numerous ATS/source modules call `httpx` with
  redirects or `page.goto()` directly.
- Decision: only consider adapters after tracing and enforcing a single
  JobFinder-owned URL safety boundary.

## Medium findings

### SEC-007 — No release/provenance evidence

- GitHub reports no published releases.
- Only `main` is supported.
- No signed artifacts, release provenance or upstream SBOM is present.
- The exact captured commit has no combined status contexts and no
  PR-triggered workflow runs exposed through the GitHub connector.
- Decision: source review must remain commit-specific; do not trust a moving
  branch as a distributable.

### SEC-008 — Public document tracer collects recipient metadata

- Evidence: tracer models and `/cv/` public route.
- Stored events include user-agent family, OS family, referrer host, hashed IP
  and bot classification.
- Decision: reject document-open tracking for JobFinder on privacy and product
  boundary grounds.

### SEC-009 — Broad external integrations and platform risk

- LinkedIn, Jobright, Gmail and Telegram add account, credential and Terms of
  Service exposure.
- The upstream legal disclaimer acknowledges that some scraping features may
  violate platform terms.
- Decision: exclude these integrations from the reuse shortlist.

## Positive controls observed

- MIT license and a documented security reporting process.
- GitHub Private Vulnerability Reporting is referenced.
- CI defines read-only `contents` permission.
- CI includes Python syntax linting, backend tests, dependency audit and Docker
  builds.
- No `pull_request_target` or `workflow_run` dangerous trigger was found.
- No common real-secret prefixes or private-key headers were found in tracked
  files by the local pattern scan.
- No submodules, symlinks or tracked executable files were found.
- Sensitive settings are redacted from the settings GET response.
- API-key and Telegram webhook comparisons use timing-safe comparison.
- Telegram webhook secrets are generated with `secrets.token_urlsafe`.
- The legal disclaimer forbids automatic submission and unverified AI content.

## Tool and evidence limitations

- `gitleaks`, `trivy`, `syft`, `semgrep`, `bandit`, `pip-audit` and
  `osv-scanner` were not installed locally.
- The local secret scan used known prefixes and private-key markers; it cannot
  prove absence of all secrets.
- Dependency installation was intentionally not performed.
- No dynamic, container, browser-extension or network behavior was executed.
- OpenSSF-style checks were assessed from repository evidence, not a published
  Scorecard result.

## Gate decision

Gate 2 passes for **continued static analysis only**.

The following remain prohibited:

- `docker compose up` or image build;
- Python/npm installation from the upstream manifests;
- loading the Chrome extension;
- migrations or database creation;
- real CVs, credentials, cookies or APIs;
- copying upstream tailoring, tracking, auth or integration code.
