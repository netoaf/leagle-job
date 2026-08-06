# JobFinder v1.4.0

Release date: 2026-07-27

## Outcome

JobFinder v1.4.0 strengthens the sanitized development and release foundation
and removes a false SuccessFactors adapter requirement without adding a new
scraper, credential or dependency.

## Improvements

- 48 deterministic unit tests now cover safe networking, Eightfold,
  normalization, identity, enrichment, quality and source-health behavior.
- Product health runs the complete unit safety and pipeline foundation suite.
- CI uses least-privilege permissions, pinned official setup actions and
  complete-history Gitleaks scanning.
- URL normalization preserves job-identifying queries after removing a
  trailing slash.
- Technology extraction preserves `C#` token boundaries.
- SuccessFactors pages with visible server-rendered `/job/` links use the
  existing generic HTML scanner.
- SuccessFactors pages without those links still fail conservatively as
  `needs_adapter`.
- The Obsidian orientation path now points to the canonical workspace layout.

## Why There Is No New SuccessFactors Adapter

The current official Minsait Portugal listing returns public,
server-rendered job links. The existing no-write scanner accepted six matching
roles from that listing.

SAP's OData management API requires configured permissions. Adding that API,
a browser dependency or a separate scraper would make beginner setup more
complex without improving the demonstrated source.

The release therefore fixes capability detection and keeps the previous
adapter-needed state for JavaScript-only variants.

## Privacy And Safety

- no User Layer file is tracked or packaged from the active workspace;
- neutral CV, profile, scoring, rules, email and portal templates are copied
  into the beginner ZIP;
- no API key, credential, CV, report, application history or personal source
  list is included;
- no automatic application, email, upload or form submission was added;
- no JobNavigator or SAP source code was copied;
- the existing MIT attribution for the Eightfold protocol remains unchanged.

## Upgrade

User Layer files remain local and are not replaced by the update mechanism.
New users should verify the release checksum, extract the ZIP and run
`setup.bat`.
