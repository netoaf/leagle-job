# Eightfold Adapter Integration

Execution date: 2026-07-23

## Decision

**Promote the focused Eightfold adapter. Do not promote any other
JobNavigator runtime component.**

The previous source-health report classified the Microsoft careers source as
SAP SuccessFactors because the page configuration contains
`position.system_id:successfactors`. That signal describes the underlying ATS,
not the public source interface. The live page identifies itself as powered by
Eightfold and exposes rendered job cards plus a public same-origin detail API.

Microsoft's official careers pages now direct job searches to
`apply.careers.microsoft.com`. Its hiring FAQ describes the new recruiting
system and treats the old global site as legacy:

- <https://careers.microsoft.com/v2/global/en/hiringfaqs.html>
- <https://careers.microsoft.com/v2/global/en/professions.html>
- <https://apply.careers.microsoft.com/careers>

## Why this is the correct reuse boundary

JobNavigator revision
`387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb` contains useful Eightfold protocol
knowledge in:

- `backend/scraper/ats/generic.py`;
- `backend/scraper/ats/_descriptions.py`.

The useful concepts are narrow:

1. identify Eightfold job-card links in the rendered listing;
2. paginate through the explicit `Next jobs` control;
3. derive `/api/apply/v2/jobs/{id}` on the job URL's own origin;
4. read `job_description` from the public JSON payload.

JobFinder reimplements those concepts in Node and retains its own
normalization, title filters, quality gate, identity, deduplication, scan
history and human-review policy. The JobNavigator database, API, UI, scheduler,
authentication, scoring, extension and external integrations remain rejected.

## Security and privacy controls

- credential-free HTTPS source URL required;
- fresh browser context with service workers disabled;
- central Playwright network guard on every browser request;
- images, media and fonts blocked;
- maximum five listing pages and 100 collected links;
- detail requests only after the title filter passes;
- API URL derived from a validated `/careers/job/{id}` path;
- job URL and detail API must share the exact origin;
- `safeFetch` requires HTTPS, an exact hostname allowlist, at most two
  redirects, a 12-second timeout and a 2 MiB response cap;
- JSON content type and payload shape checked;
- no sign-in, form fill, upload, application submission, email or User Layer
  write;
- fixtures contain only invented companies, roles and URLs.

## Verification evidence

- syntax checks: pass;
- synthetic Eightfold regressions: 7/7 pass;
- existing safe-fetch regressions: pass;
- source audit: Microsoft changed from `needs_adapter/successfactors` to
  `healthy/eightfold`;
- live anonymous listing test: 20 unique job cards across the bounded sample;
- live anonymous end-to-end test: one public job normalized with a 5,551
  character description;
- normal JobFinder dry-run: zero accepted Microsoft candidates in the tested
  pages, correctly explained by the user's existing positive/negative title
  filter rather than an adapter failure;
- no reports, history, applications, CVs or profile files written by the live
  checks.

## Attribution

JobNavigator is MIT licensed. `THIRD_PARTY_NOTICES.md` records the exact
revision, source paths, modifications, copyright and permission notice.

## Release status

The existing `JobFinder-v1.2.0.zip` and clean Git bundle were approved before
this adapter was integrated. Their checksums remain valid for that earlier
baseline, but they do **not** contain the Eightfold adapter. A new sanitized
release must be generated and re-attested before this change is distributed.
