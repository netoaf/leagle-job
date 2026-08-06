# Isolated Research Base Handoff

## Gate 5 decision

**Pass. The research base is ready for a later component-specific plan.**

The base contains no executable JobNavigator code. It is outside the active
JobFinder package and the upstream clone, work directory and artifacts
directory are ignored.

## Prepared artifacts

- `prototypes/contracts/normalized-job.schema.json` defines the output boundary
  for future adapters.
- `prototypes/contracts/adapter-evaluation-cases.json` defines initial safety
  and robustness cases.
- `prototypes/fixtures/synthetic-job.json` is a non-personal offline example.
- `prototypes/THIRD-PARTY-NOTICE-TEMPLATE.md` captures provenance, license,
  modifications and verification if source is copied later.

All seven JSON evidence/contract files in the intake workspace parsed
successfully. The synthetic fixture contains every required field and passed
the local contract assertions for HTTPS URLs, types and date shape.

## Isolation validation

- `research/jobnavigator/upstream/` is ignored.
- `research/jobnavigator/work/` is ignored.
- `research/jobnavigator/artifacts/` is ignored.
- `.env`, virtual environments and `node_modules` below the research area are
  ignored.
- The clone push URL is `DISABLED`; the fetch origin remains the public GitHub
  repository.
- The clone is clean and remains at the reviewed commit.
- No dependency, container, browser, database, migration or extension was run.
- No personal contact pattern was found in the created analysis/prototype
  files.

## Promotion rules

Nothing in this directory may move into JobFinder merely because it appears on
the shortlist. A future plan must promote one component at a time:

```text
need demonstrated
  -> component threat model
  -> clean-room design or attributed adaptation
  -> synthetic fixtures
  -> offline unit tests
  -> safe-fetch integration
  -> JobFinder normalization/identity/quality gates
  -> license and privacy review
  -> full JobFinder health
  -> human approval
```

The first implementation plan should be the central outbound URL-safety
boundary. Network adapters must not be added before that boundary exists.

## Current product gate

`npm run verify` passes with 45 application rows, zero errors and zero
warnings.

`npm run jobfinder:health` passes 12 of 13 checks. The pre-existing
`maybe-support-role.yml` scoring example expects `discard`, while the engine
returns `maybe` with 68/100. This investigation did not modify that fixture,
the scoring engine or any active JobFinder source.

Integration remains blocked until the scoring expectation/rule is resolved and
the full health command is green.

## Deliberate stopping point

The requested clone, static analysis, organization and research-base
preparation are complete. Source extraction, modification and implementation
belong to the next plan, as requested.
