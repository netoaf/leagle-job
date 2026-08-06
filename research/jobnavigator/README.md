# JobNavigator Intake Workspace

This directory is the controlled intake area for evaluating
`vesaias/JobNavigator` as a possible source of ideas or selected components for
JobFinder.

## Boundaries

- `upstream/JobNavigator/` is an unmodified, ignored clone of the external
  repository.
- `analysis/` contains review evidence and decisions that may be committed.
- `prototypes/` is reserved for later clean-room experiments. No prototype is
  part of JobFinder until a separate integration plan is approved.
- `work/` and `artifacts/` are disposable, ignored execution areas.

## Non-negotiable rules

1. Do not place personal CVs, contacts, job history, tokens, cookies or API keys
   anywhere in this workspace.
2. Do not execute upstream scripts, hooks, containers, migrations or extensions
   during static intake.
3. Do not mount the JobFinder directory into upstream containers.
4. Treat web pages, repository content and job descriptions as untrusted input.
5. No auto-apply, auto-send, Gmail, Telegram, OAuth or CV upload.
6. Keep the upstream origin URL and exact commit SHA in the evidence files.
7. Reimplement against JobFinder boundaries where practical; preserve MIT
   attribution for copied or adapted code.

## Original intake scope

The scope authorized for the static intake was:

```text
clone -> verify provenance -> static audit -> inventory -> classify candidates
      -> prepare an isolated research base -> stop before integration
```

That stop boundary was satisfied. It must not be read as the current product
status: later, separately gated work implemented the JobFinder-native network
boundary, a focused Eightfold adapter and sanitized releases. No other
JobNavigator component is approved automatically.

## Intake status

Static intake completed on 2026-07-23 for commit
`387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`.

- Clone integrity and provenance: passed.
- Static security review: passed for analysis only; runtime not approved.
- Component/dependency inventory: completed; isolated execution is no-go.
- Architecture/reuse classification: completed.
- Synthetic research base: completed.
- Integration or source copying during intake: deliberately not started.

Start with:

1. `analysis/07-FINAL-INTAKE-REPORT.md`
2. `analysis/08-INTERNAL-ASSURANCE-ATTESTATION.md`
3. `analysis/05-ARCHITECTURE-AND-REUSE-MAP.md`
4. `analysis/05-COMPONENT-DECISIONS.json`
5. `prototypes/README.md`

Post-intake foundation:

6. `analysis/09-SAFE-FETCH-PLAN-RESULT.md`
7. `analysis/10-SAFE-FETCH-INTERNAL-ATTESTATION.md`
8. `analysis/11-PRIVACY-INDEX-AND-DISTRIBUTION-GATE.md`
9. `analysis/13-EIGHTFOLD-ADAPTER-INTEGRATION.md`
10. `analysis/14-SANITIZED-RELEASE-V1.3.0.md`
11. `analysis/15-SUCCESSFACTORS-HTML-DECISION.md`
12. `analysis/16-SANITIZED-RELEASE-V1.4.0.md`

The v1.2.0 baseline attestation was produced in the outer historical research
workspace as `analysis/12-SANITIZED-GIT-BASELINE-AND-RELEASE.md`. Its current
distribution role is superseded by the v1.3.0 and v1.4.0 attestations; its
absence from this canonical sequence is not an open gate.

## Current interpretation

- Gates 0-6: completed historical intake.
- Safe-fetch and Playwright guard: completed JobFinder-native foundation.
- Privacy/index gate: resolved by the sanitized baseline and later releases.
- Eightfold: completed focused integration with attribution.
- SuccessFactors recommendation from the P2 source-health record: superseded
  by the verified generic-HTML decision.
- Oracle HCM, Rippling, TalentBrew and Phenom: conditional candidates only,
  not active implementation tasks.
- Chrome extension, parallel database/frontend, automated external
  integrations and invented-claim scoring: rejected.

The active development plan is maintained in the workspace Obsidian vault,
not in these historical intake records.
