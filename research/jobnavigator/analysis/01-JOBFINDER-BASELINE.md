# JobFinder Baseline Before JobNavigator Intake

Recorded: 2026-07-23, Europe/Lisbon

## Repository

- Workspace: `<workspace-root>`
- Branch: `master`
- HEAD: `0e92625b75d2f8e021556a2785328e17545215af`
- JobFinder version: `1.2.0`
- Worktree: dirty before this intake, with many user-owned modified, deleted and
  untracked files.

No existing changes may be reset, cleaned, staged or overwritten as part of
this intake.

## Safe distribution reference

- Artifact: `career-ops-main/career-ops-main/dist/JobFinder-v1.2.0.zip`
- SHA-256:
  `3D15D5FF12B49BBAD3B5C5D2B93DBA8BC14C19C88BD3A7311DA8AAAD73524ABD`

The research clone is a sibling of the active JobFinder project and is outside
the package builder's project root.

## Available local tooling

- Git `2.53.0.windows.1`
- Node.js `24.15.0`
- npm `11.12.1`
- Docker `29.6.1`
- Python `3.11.8`

Availability does not authorize execution of upstream code.

## Baseline quality checks

Run before acquisition:

- `npm.cmd run verify`: PASS, 45 tracker entries, 0 errors and 0 warnings.
- `npm.cmd run jobfinder:health`: FAIL, 1 of 13 checks failed.

The health failure is limited to the personalized scoring example:
`maybe-support-role.yml` currently evaluates to `maybe` at 68/100 while its
fixture expects `discard`. All other health checks passed, including doctor,
config validation, pipeline, draft gates, browser safety, vault snapshot and Go
dashboard tests.

This is a pre-existing baseline condition. Static research may proceed because
it cannot affect scoring or user data, but no JobNavigator code may be
integrated while the active JobFinder health gate is red.
