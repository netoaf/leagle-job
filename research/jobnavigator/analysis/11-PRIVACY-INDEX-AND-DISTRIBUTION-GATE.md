# Privacy, Git Index and Distribution Gate

Execution date: 2026-07-23

## Decision

The original three-file index correction was necessary but insufficient.
JobFinder's Data Contract classifies CVs, candidate configuration, runtime
data, reports, saved job descriptions and interview preparation as local User
Layer. The gate was therefore expanded before any ATS adapter work.

Result:

- current Git index: **PASS for User Layer separation**;
- local file preservation: **PASS**;
- safe distributable ZIP: **PASS**;
- clean-install smoke test: **PASS**;
- existing Git history: **NO-GO for publication**;
- JobNavigator adapter promotion: **NO-GO until a clean checkpoint/history
  decision and a demonstrated source need exist**.

## Validated plan

1. Re-read the JobFinder instructions, Data Contract, stabilization plan, AI
   risk controls, quality gates and JobNavigator handoff.
2. Establish a green product baseline.
3. Inventory the complete tracked User Layer instead of relying on the
   three-file test.
4. Add ignore rules for local CVs, candidate context, runtime data, reports,
   saved job descriptions and interview material.
5. Remove tracked User Layer files from the Git index only.
6. Verify every local file byte-for-byte by SHA-256 before and after the index
   operation.
7. Extend the test suite to cover all User Layer categories and distinguish a
   clean current index from contaminated history.
8. Build the existing privacy-audited ZIP and run a clean-install smoke test.
9. Stop before commit, push or history rewrite.

## Actions and preservation evidence

- 81 private/local artifacts are staged for removal from the current index:
  79 below the active CareerOps package and 2 local artifacts at workspace
  root.
- All 81 files remained on disk.
- All 81 SHA-256 values matched before and after the index operation.
- `git ls-files` reports zero current User Layer violations in the active
  CareerOps package.
- Ignore checks cover the real local paths; neutral templates and `.gitkeep`
  placeholders remain distributable.
- No commit, push, remote creation or history rewrite was performed.

Staged deletion means "remove from the next Git snapshot"; it does not mean
the local working files were deleted.

## Verification

Product and privacy:

- `node test-all.mjs --quick`: 82 functional/current-index checks pass; the
  deliberate history warning remains.
- `npm.cmd run jobfinder:health`: 14/14 pass.
- `git diff --check`: pass.
- current private tracked count: 0.

Distribution:

- artifact: `JobFinder-v1.2.0.zip`;
- SHA-256:
  `636F2979687A1461C21292CB5450AD3AB6443D710A68AE6AD55D57829802067B`;
- ZIP entries: 203;
- required setup/templates missing: 0;
- forbidden private paths found: 0;
- package privacy markers checked by the packager: 10;
- extracted `setup.ps1 -SkipBrowser`: pass;
- extracted-package `npm test -- --quick`: 83/83 pass;
- extracted-package `doctor.mjs`: pass.

Setup metadata was also reconciled: `package-lock.json` is no longer ignored,
`npm test` is available, Node `>=18` is declared in the package metadata and
the optional dashboard documentation now matches its Go 1.24.2 module
requirement.

The browser download was deliberately skipped during the smoke test because
the host already had Playwright Chromium. The normal beginner installer still
installs Chromium unless `-SkipBrowser` is explicitly passed.

## Important history limitation

The repository has one existing commit and no configured remote. That commit
still contains User Layer material. Removing paths from the current index does
not erase older Git objects.

Therefore:

- the generated ZIP is the approved sharing artifact;
- the repository itself must not be published or pushed as a public repo;
- a later plan must choose between a sanitized new repository/root commit or
  a verified history rewrite;
- that operation must include a complete staged-scope review and a fresh
  privacy scan before any push.

## Adapter gate

No configured Oracle HCM, Rippling, TalentBrew or Phenom source currently
demonstrates a real adapter need. Adding one now would be speculative dead
code and would grow the already large scanner.

After a clean checkpoint/history decision, the next adapter plan must begin
with a concrete public board marked `needs_adapter`. Without that evidence,
retain only the synthetic contracts and do not add runtime code.
