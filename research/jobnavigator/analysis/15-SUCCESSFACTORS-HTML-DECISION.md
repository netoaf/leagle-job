# SuccessFactors Server-Rendered HTML Decision

Execution date: 2026-07-27

## Decision

**Do not implement a SuccessFactors adapter for the current Minsait source.**

Use JobFinder's existing generic HTML scanner when a SuccessFactors careers
page contains usable, server-rendered `/job/` anchors. Continue classifying
SuccessFactors pages without those anchors as `needs_adapter`.

This is a capability decision, not a claim that every SuccessFactors site is
compatible with generic HTML.

## Evidence

The current official Minsait careers entry redirects to the Indra careers
platform. Its public Portugal search listing:

- returns HTTP 200 over credential-free HTTPS;
- exposes job titles and `/job/` links in the initial HTML response;
- does not require Playwright to enumerate the visible listing;
- produced six accepted Portugal candidates in an isolated JobFinder dry run;
- remained healthy in the subsequent full source audit.

The SAP SuccessFactors OData documentation describes role and API permissions
for Job Requisition access. That authenticated management API is not an
appropriate dependency for a local beginner installation that must work
without employer credentials:

- <https://help.sap.com/docs/successfactors-platform/sap-successfactors-api-reference-guide-odata-v2/jobrequisition>
- <https://help.sap.com/docs/successfactors-recruiting/setting-up-and-maintaining-sap-successfactors-recruiting/configuring-odata-api-for-job-application>

The simpler public HTML route therefore provides more value with less
privilege, less configuration and less failure surface.

## Implementation boundary

`lib/source-adapters.mjs` keeps the existing adapter precedence. When a matched
SuccessFactors rule also has at least one visible server-rendered `/job/`
anchor, detection reports:

```text
adapter: generic_html
scanner: existing
reason: server-rendered SuccessFactors job links
```

Otherwise the previous result is preserved:

```text
adapter: successfactors
scanner: needed
```

No new network client, dependency, browser path, API endpoint, credential,
pagination mechanism or User Layer write was added.

## Tests

The synthetic fixture
`tests/fixtures/successfactors-server-rendered.html` contains only an invented
company page, role and identifier.

The regressions prove:

1. server-rendered SuccessFactors job links select generic HTML;
2. the same result applies when the hostname itself identifies
   SuccessFactors;
3. SuccessFactors markup without server-rendered job links still requires an
   adapter;
4. embedded SuccessFactors text does not override the existing Eightfold
   detector.

Unit result after implementation: 48/48 passing.

## Privacy, security and licensing

- No CV, profile, credential, contact detail or candidate evidence is present
  in the fixture or code.
- Live validation used the existing `safeFetch` boundary and no-write scan
  mode.
- The generic scanner continues to use bounded response sizes, timeouts and
  safe URL validation.
- No JobNavigator or SAP source code was copied or adapted.
- No new third-party attribution is required.

## Residual boundary

Some SuccessFactors sites may be JavaScript-only, permissioned or structurally
different. They must fail conservatively as `needs_adapter` until a current,
high-value source proves the need for a separate implementation.
