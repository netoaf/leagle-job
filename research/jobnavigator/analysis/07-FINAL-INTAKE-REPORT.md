# Final JobNavigator Intake Report

Assessment date: 2026-07-23

## Executive decision

**The intake process meets the defined professional quality gates. The
JobNavigator runtime does not meet the threshold for execution or integration
into JobFinder.**

Approved:

- retain the isolated clone for reproducible review;
- retain the evidence, component inventory and synthetic research base;
- begin a later plan for a JobFinder-native safe-fetch boundary;
- after that boundary, evaluate Oracle HCM, Rippling and TalentBrew one at a
  time; evaluate Phenom only if a real source requires it.

Not approved:

- starting the upstream Docker stack;
- installing its Python/npm dependencies;
- loading the Chrome extension;
- using personal data or credentials;
- copying source into JobFinder without a separate plan;
- importing its scoring, candidate database, tracker or external integrations.

## Assurance statement

This review is aligned with NIST SSDF, OWASP SCVS, SLSA provenance and OpenSSF
Scorecard practices. It is evidence-backed and reproducible within the stated
limits, but it is not a third-party formal certification and does not claim
that JobNavigator is vulnerability-free.

See `REFERENCES.md` for the primary sources.

## Provenance

- Repository: `https://github.com/vesaias/JobNavigator`
- GitHub repository ID: `1211525664`
- Default branch: `main`
- Reviewed commit: `387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`
- Commit subject: `Model updates + Resumes rename`
- Commit date: `2026-07-21T17:33:54+02:00`
- Acquisition: shallow HTTPS clone, no tags, submodules or repository hooks
- Worktree: clean
- Object check: `git fsck --full` returned no errors
- Fetch origin: public GitHub repository
- Push origin: disabled
- License: MIT
- License SHA-256:
  `BFE3C2F18948E74EE54A9A229D67A1E300B8B457A3BEB64C910472B8A87B8480`

The GitHub API exposed no combined status contexts for the exact commit during
the assessment. No PR-triggered workflow run was available for that revision.
Therefore CI success for the exact commit is not asserted.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| 0. Context and boundaries | Pass | JobFinder documents, dirty-worktree baseline and decision log |
| 1. Controlled acquisition | Pass | `02-ACQUISITION.*` |
| 2. Static security | Pass for analysis only | `03-SECURITY-INTAKE.md`, `03-RISK-REGISTER.json` |
| 3. Components/dependencies | Complete; runtime no-go | `04-*` |
| 4. Architecture/reuse | Pass for later focused plan | `05-*` |
| 5. Research base | Pass | `06-RESEARCH-BASE-HANDOFF.md`, `prototypes/` |
| 6. Final validation | Pass with product integration blocked | This report |

## Principal security decisions

1. Critical reject: the upstream tailoring prompt explicitly permits invented
   facts and metrics. This conflicts with JobFinder's anti-invention rule.
2. High reject: the Chrome extension removes browser security headers for all
   URLs and uses broad host permissions.
3. High risk: credentials can be stored in plaintext in the database,
   browser local storage and Chrome sync storage.
4. High risk: weak first-run authentication and network-exposed default
   services make the provided stack unsuitable to run unchanged.
5. High risk: missing lockfiles/hashes/digests, mutable build inputs and a
   non-blocking dependency audit prevent a reproducible trust decision.
6. High risk: the URL-safety helper has good tests but does not cover every
   outbound HTTP and browser path.
7. Reject: document tracing and LinkedIn, Jobright, Gmail and Telegram flows
   fall outside JobFinder's privacy, legal and approval boundaries.

## Useful engineering surface

The component matrix narrows a large alternative application to:

- reimplement first: a central outbound URL-safety boundary;
- reimplement later: Oracle HCM, Rippling and TalentBrew adapters;
- evaluate later: a typed and allowlisted Phenom adapter;
- use as test/reference ideas only: ATS edge cases, pagination caps and source
  health patterns;
- keep existing JobFinder implementations for Greenhouse, Ashby, Lever,
  Workday, SmartRecruiters, normalization and deduplication.

No upstream source was copied into the active JobFinder codebase.

## Final validation evidence

- Seven JSON inventory/contract files parse successfully.
- The synthetic fixture has no missing required fields and passes local
  contract assertions.
- Created analysis/prototype files contain no detected email, Portuguese
  mobile-number or LinkedIn-profile contact patterns.
- Ignored-boundary checks pass for `upstream/`, `work/` and `artifacts/`.
- The reviewed clone is clean, fixed at the recorded SHA and has push disabled.
- `npm run verify`: pass, 45 rows, 0 errors, 0 warnings.
- `npm run jobfinder:health`: 12/13 pass.
- The known failing health case is unchanged from the pre-intake baseline:
  `maybe-support-role.yml` expects `discard`, but evaluates to `maybe` at
  68/100.
- The JobFinder v1.2.0 safe ZIP remains present and unchanged:
  SHA-256
  `3D15D5FF12B49BBAD3B5C5D2B93DBA8BC14C19C88BD3A7311DA8AAAD73524ABD`.

## Checks deliberately not performed

- No upstream dependency installation.
- No container build or start.
- No database migration.
- No browser/extension execution.
- No real CV, account, token, cookie or API key.
- No dynamic vulnerability scan or complete transitive SBOM because the
  required tools/lockfiles were unavailable and installation was outside the
  static-intake authorization.
- No live scraper calls or terms-of-service testing.

## Residual blocker and next decision

The intake is complete. Integration remains blocked by:

1. the existing JobFinder health failure;
2. the absence of a JobFinder-wide safe outbound-fetch boundary;
3. the need for a component-specific license, threat, test and implementation
   plan.

The next plan should cover only the safe-fetch boundary and one adapter at a
time. That preserves JobFinder's source of truth, keeps review small and makes
each promotion reversible and independently testable.
