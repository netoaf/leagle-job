# JobNavigator Research Base

This directory is a safe handoff for a later extraction plan. It contains no
JobNavigator executable code and is not part of the JobFinder runtime or
release package.

## Current contents

- `contracts/normalized-job.schema.json`: JobFinder-facing output boundary for
  future adapter prototypes.
- `contracts/adapter-evaluation-cases.json`: synthetic acceptance and safety
  cases.
- `fixtures/synthetic-job.json`: non-personal example output.
- `THIRD-PARTY-NOTICE-TEMPLATE.md`: attribution checklist if MIT source is
  copied or closely adapted later.

## Rules

- Synthetic data only.
- No `.env`, API keys, cookies, CVs, emails, phone numbers or accounts.
- No network access by default.
- No import from `upstream/JobNavigator`.
- No database, browser extension, container or external integration.
- Do not copy code until a separate component-specific plan is approved.
- A prototype must emit the existing JobFinder contract and pass JobFinder's
  normalization, identity, quality, privacy and health gates.

## Proposed future layout

When a separate plan is approved, create one directory per candidate:

```text
adapters/
  oracle-hcm/
  rippling/
  talentbrew/
  phenom/
```

Each directory must include a design note, provenance record, synthetic
fixtures, threat cases, tests and an explicit promote/reject decision.
