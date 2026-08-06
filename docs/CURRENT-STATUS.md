# Current Leagle Job Status

Last reconciled: 2026-08-06

## Stable Baseline

Leagle Job v1.4.0 is the current approved local-distribution baseline. This
baseline was originally validated under the local name JobFinder; the rebrand
does not change its functional or release evidence.

- clean-bundle tag: `v1.4.0` (the canonical development repository itself
  has no `v1.4.0` tag);
- complete sanitized history rooted at `fe71d4ff66d388626be144667a9876b3170d00ed`;
- remotes at release: none;
- release decision: approved for local distribution.

The artifact checksums, privacy checks and fresh-install evidence are recorded
in
[`16-SANITIZED-RELEASE-V1.4.0.md`](../research/jobnavigator/analysis/16-SANITIZED-RELEASE-V1.4.0.md).

The previous v1.3.0 attestation remains available in
[`14-SANITIZED-RELEASE-V1.3.0.md`](../research/jobnavigator/analysis/14-SANITIZED-RELEASE-V1.3.0.md).

## Implemented Foundations

- System Layer and local User Layer are separated by the data contract.
- Candidate data, reports, runtime data and generated output remain local and
  ignored by Git.
- Direct HTTP consumers use the existing safe-fetch boundary.
- Playwright fallbacks use the companion network guard.
- The safe-fetch boundary has 17 synthetic security regressions.
- Eightfold support is implemented with a bounded listing flow, same-origin
  detail API, seven synthetic regressions and MIT attribution.
- Existing Leagle Job normalization, quality, scoring, tracking and
  review-first application flows remain the source of truth.
- The system does not submit applications, upload CVs or send emails
  automatically.

## Decision Precedence

The analysis reports are historical evidence and should not be rewritten when
a later gate changes the disposition:

- the release-pending statement in
  `13-EIGHTFOLD-ADAPTER-INTEGRATION.md` is superseded by the v1.3.0 release
  attestation;
- the privacy/index blockers in
  `09-SAFE-FETCH-PLAN-RESULT.md` and
  `10-SAFE-FETCH-INTERNAL-ATTESTATION.md` were resolved by the sanitized
  history and release gates;
- `05-COMPONENT-DECISIONS.json` is the current machine-readable component
  decision record.

## Foundation Gate Result

The v1.4.0 foundation adds:

- 48 passing unit tests covering network safety, Eightfold, normalization,
  identity, enrichment, quality and source-health classification;
- the complete unit suite as a mandatory product health check;
- a least-privilege CI workflow with official setup actions pinned by commit;
- complete-history Gitleaks scanning with a pinned binary checksum;
- Windows beginner-setup, full product, dashboard and sanitized-package gates.

The new tests found and fixed two deterministic defects: `C#` token detection
and trailing-slash normalization before a URL query. No new live source
adapter is included in this release.

## Source Health Revalidation

The 2026-07-27 live audit checked 184 active sources:

- 158 healthy;
- 14 dead URLs;
- 7 fetch failures;
- 5 blocked;
- 0 requiring a new adapter.

The current Minsait/Indra SuccessFactors listing exposes public,
server-rendered `/job/` links. The existing bounded generic HTML scanner found
six matching Portugal roles in a no-write dry run. Adding an authenticated
OData integration or a browser adapter would therefore add complexity without
improving this source.

Source detection now classifies SuccessFactors pages with usable
server-rendered job links as `generic_html/existing`. SuccessFactors pages
without such links remain `successfactors/needed`. Two synthetic regressions
lock both sides of that boundary, and the existing Eightfold precedence test
remains green.

The live source URLs, audit snapshot and cleanup report remain User Layer
runtime evidence and are not part of a public release.

## Next Product Decisions

After the foundation gate is green:

1. continue fixing high-value dead or redirected sources in small,
   evidence-backed batches;
2. add a SuccessFactors adapter only if a current high-value source lacks
   usable server-rendered job links;
3. test whether Bizneo and embedded-Ashby detection should influence scanner
   routing before changing either path;
4. improve evidence-preserving job enrichment without inventing candidate or
   compensation data;
5. split large scanner modules only along tested behavior boundaries.

Source-health files are User Layer runtime evidence and are intentionally not
part of a public release.
