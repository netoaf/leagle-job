# Leagle Job

Leagle Job is a local-first, Portugal-first job-search pipeline based on
[Career-Ops](https://github.com/santifer/career-ops). It finds and evaluates
jobs, keeps an auditable local pipeline and prepares application material for
human review.

It is deliberately conservative: it does not submit applications, send email
or upload CVs. An optional, explicitly configured Codex/Gmail bridge can create
an **unsent** Gmail draft only after every local safety gate passes.

## What is implemented

- Job discovery from supported boards, ATS platforms and company career pages.
- Evidence-preserving normalization, quality filtering and multi-key
  deduplication.
- Deterministic 0--100 score for role fit, technical stack, mentorship,
  progression, location/work mode, compensation and clarity.
- Markdown reports, application packs, deterministic CV selection and
  follow-up tracking.
- A local Go terminal dashboard for browsing results and updating status.
- Network safety for HTTP and browser extraction: public-address validation,
  redirect checks and bounded requests.
- Optional, fail-closed Gmail draft and portal-preparation workflows.

## What it does not claim to do

- It is not a hosted service, web app, API or multi-user system.
- It has no database, ORM, scheduler, Docker deployment or automatic job
  application flow.
- A configured source is not proof of current coverage; run the coverage audit
  before claiming broad discovery.
- LinkedIn, Indeed and IEFP are supplemental/manual lanes, not all
  first-class Node scanners.
- Codex, a Gmail connector and a browser session are optional integrations, not
  prerequisites for search, ranking, tracking or the dashboard.

## Quick start

Prerequisites: Node.js 18 or later; Playwright Chromium for browser-based
verification; Go 1.24.2 or later only when building the dashboard.

```powershell
npm install
npx playwright install chromium
npm run doctor
npm run jobfinder:health
```

Create personal files from the templates only when they do not already exist:

```powershell
Copy-Item config/profile.example.yml config/profile.yml
Copy-Item config/scoring.example.yml config/scoring.yml
Copy-Item config/jobfinder-rules.example.yml config/jobfinder-rules.yml
Copy-Item templates/portals.example.yml portals.yml
Copy-Item modes/_profile.template.md modes/_profile.md
```

These files, together with your CV, reports and tracker, are the local User
Layer. They are ignored by Git and must not be bundled in a release. See
[DATA_CONTRACT.md](DATA_CONTRACT.md).

## Everyday workflow

```powershell
# Confirm local health first.
npm run jobfinder:health

# Search Portugal-first without writing user data.
npm run leagle:new:dry-run -- --limit 80

# Write only a small, reviewed batch.
npm run leagle:new -- --limit 80 --write-limit 5

# Reconcile tracker, reports and ledgers.
npm run verify

# Inspect coverage honestly.
npm run coverage:audit
npm run sources:status
```

For a single vacancy:

```powershell
npm run evaluate-url -- --url "https://example.com/job"
```

Open the dashboard with `./run-dashboard.ps1`, or build it from `dashboard/`
when Go is available.

## Safety boundary

- Human approval is required before every final send or submit action.
- Unknown candidate facts remain `a confirmar`; the tool must not invent skills,
  seniority, credentials, metrics or eligibility.
- A Gmail draft requires a confirmed recipient, selected attachment, fresh
  Playwright proof of an active official vacancy and a passing review chain.
- Portal preparation may fill only confirmed fields. It stops before upload,
  CAPTCHA, consent choices, sensitive identifiers and final submission.

## Documentation map

- [Current product status](docs/CURRENT-STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Operational runbook](docs/operational-runbook.md)
- [Application actions](docs/application-actions.md)
- [Gmail draft boundary](docs/gmail-adapter.md)
- [Codex routing](docs/CODEX.md)
- [User/system data contract](DATA_CONTRACT.md)

## Development checks

```powershell
npm run test:unit
npm test
npm run jobfinder:health
npm run verify
```

Use the exact checkout being released when running these commands. Public CI is
only evidence for the revision it actually builds.

## Attribution and licence

Leagle Job is a local adaptation of Career-Ops by Santiago Fernández de
Valderrama. Preserve the upstream MIT licence, citation and attribution files
when redistributing or extending this project.
