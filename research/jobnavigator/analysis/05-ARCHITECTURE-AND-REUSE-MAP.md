# Architecture and Reuse Map

Target revision:
`387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`

## Gate 4 decision

**Pass for a focused future extraction plan. Do not merge or copy code yet.**

JobNavigator is a complete alternative application, not a library. Its
database, API, React interface, scheduler, authentication, extension and
candidate-data model would create parallel sources of truth in JobFinder.
Those layers are therefore not migration candidates.

The useful surface is narrow: selected ATS protocol knowledge, SSRF test
patterns, pagination caps and a few source-health ideas.

## Architecture comparison

| Concern | JobFinder source of truth | JobNavigator equivalent | Decision |
|---|---|---|---|
| Candidate identity/evidence | `config/profile.yml`, candidate context and evidence bank | Persona and Resume database tables | Keep JobFinder |
| Scoring | `config/scoring.yml` and `job-scoring-service.mjs` | LLM scorer and seeded prompts | Reject upstream |
| Discovery | `scan-jobs.mjs` plus `lib/source-adapters.mjs` | Python scraper dispatcher and ATS handlers | Add only missing adapters |
| Normalization | `lib/job-normalizer.mjs` | Per-scraper dictionaries and shared filters | Keep JobFinder |
| Identity/deduplication | `lib/job-identity.mjs`, `lib/job-index.mjs` | Shared dedup/URL helpers and SQL constraints | Keep JobFinder |
| Quality | `lib/job-quality-gate.mjs` | Scraper title/URL filters | Keep JobFinder; study test cases |
| Applications | `data/applications.md` and application stores | PostgreSQL Application model | Reject parallel store |
| Dashboard | Local Go TUI | React application board/stats | Idea-only |
| Application material | Review-first packs and CV diffs | Resume/cover-letter builders | Keep JobFinder |
| Automation | Explicit local commands and human approval | Scheduler, monitor, integrations | Reject external automation |

## Existing adapter overlap

JobFinder already recognizes and scans Greenhouse, Ashby, Lever, Workday,
SmartRecruiters, Workable and Teamtailor, with generic and controlled browser
fallbacks. Its identity layer already produces canonical URLs, ATS external
keys, company/role keys, similarity keys and description hashes.

Replacing those paths with the Python implementations would increase
complexity without establishing better behavior. Only missing, proven edge
cases should become new regression tests.

## Shortlist for the next plan

### 1. Central outbound URL safety boundary

Priority: critical prerequisite.

Reimplement the useful concepts from JobNavigator's URL-safety module in
JobFinder-native Node code:

- allow only HTTP(S), with HTTPS preferred;
- resolve and validate every returned IPv4/IPv6 address;
- reject loopback, private, link-local, reserved, multicast, unspecified and
  CGNAT ranges;
- disable automatic redirects and revalidate every hop;
- cap redirects, response bytes, time, requests and pagination;
- require every source adapter and browser entry point to use the boundary.

The upstream helper is positive evidence, but its coverage is incomplete:
many ATS and browser paths call `httpx` or `page.goto` directly.

### 2. Oracle HCM adapter

Priority: high.

Extract protocol knowledge, not the full Python module. The future adapter
must parse the candidate-experience site identifier, use an approved Oracle
host mapping, cap pages/results, check response type/size and emit the existing
JobFinder normalized-job contract.

### 3. Rippling adapter

Priority: high.

The public board API and UUID deduplication are useful. The future version must
use HTTPS, remove the upstream US-specific location preference and pass
results through JobFinder normalization, identity and quality gates.

### 4. TalentBrew adapter

Priority: medium.

The AJAX result endpoint is a useful pattern. The future version needs strict
origin validation, response checks, bounded parsing and synthetic regression
fixtures.

### 5. Phenom declarative adapter

Priority: evaluate later.

Do not adopt the raw `POST|URL|JSON` convention. It permits arbitrary
endpoints and payloads in configuration. If real JobFinder sources require
Phenom, define a typed, allowlisted schema with a bounded payload and safe
fetch.

## Explicit rejection list

- AI prompts or logic that can invent candidate claims or metrics;
- the Chrome extension and its global security-header removal;
- the PostgreSQL tracker as a replacement for JobFinder files;
- the React frontend as a second dashboard;
- first-run authentication and plaintext secret storage;
- document click tracing;
- LinkedIn, Jobright, Gmail and Telegram automation;
- employer-specific browser scraping without demonstrated need;
- Docker/Caddy deployment as part of JobFinder setup.

## License and attribution rule

The repository is MIT licensed. Ideas and independently reimplemented
protocols do not require copying source text. If expressive code or tests are
copied or closely adapted, the next plan must:

1. identify the exact source path and commit;
2. retain the MIT copyright and permission notice;
3. add a third-party notice in JobFinder;
4. record modifications;
5. review the copied dependency and security surface independently.

## Verification strategy for every accepted adapter

- synthetic fixtures with no personal or live credential data;
- positive, negative, malformed, timeout, oversized and pagination-cap cases;
- hostname-confusion and redirect-to-private-network tests;
- deterministic normalization and external-key assertions;
- no write to the User Layer;
- `npm run verify` and `npm run jobfinder:health` green before integration;
- human review of attribution and architecture boundaries.
