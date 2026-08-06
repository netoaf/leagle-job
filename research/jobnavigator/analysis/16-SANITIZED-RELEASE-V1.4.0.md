# JobFinder v1.4.0 Sanitized Release Attestation

Execution date: 2026-07-27

## Decision

**APPROVED for local distribution.**

This approval applies only to the ZIP, clean bundle and checksum manifest
listed below. It does not approve the outer/legacy repository or the canonical
development history for publication.

## Release artifacts

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `JobFinder-v1.4.0.zip` | 11,901,962 | `0EDFC8505016D8D40DF5822899B5C1BB72823F029ABD8A1F08D73D22A94C25DE` |
| `JobFinder-v1.4.0-clean.bundle` | 9,109,841 | `ED08CC52099243357A306C9CC6715CF81EBA1D87D32DAFC888FE0F1CA39D1413` |

`JobFinder-v1.4.0-SHA256SUMS.txt` contains the same values and was
independently re-read and verified against both artifacts.

## Source identity

- canonical release commit:
  `2fa5fc0c6fde4d197de99253822507aacdd04fad`;
- exact release tree:
  `5909d0baabf9189f36c581c206e4c973ec4626fe`;
- clean bundle commit:
  `093a2ba7b976442b048ebd50fb05b8e1c6e24184`;
- clean bundle tag: annotated `v1.4.0`;
- clean bundle history: one root commit;
- tracked files: 219;
- remotes in the clean source repository: none;
- symlinks: 0;
- submodules: 0;
- `git fsck --strict --no-reflogs`: pass with no messages;
- `git bundle verify`: complete history;
- a fresh clone reproduced the exact release tree and tag.

The clean bundle intentionally uses a neutral local release identity. Its
single commit has the exact same tree as the canonical release commit.

## Privacy issue caught and resolved

A direct bundle of the canonical development repository was rejected before
distribution because local Git author/tag metadata can contain personal
identity information.

The canonical history was not rewritten. Instead, the release tree was
exported into an isolated repository, committed and tagged with a neutral
local release identity, and then bundled. The temporary personal-metadata tag
created during validation was removed.

Privacy results:

- private markers derived from the active User Layer without printing values:
  10;
- marker matches in the extracted ZIP: 0;
- marker matches in the clean bundle tree: 0;
- marker matches in clean bundle Git metadata: 0;
- absolute local user-path matches in the extracted ZIP: 0;
- neutral bootstrap copies: 7/7 exact template matches;
- forbidden User Layer/development paths in the ZIP: 0;
- Gitleaks complete clean-bundle history findings: 0;
- Gitleaks pristine extracted-ZIP findings: 0.

Gitleaks 8.30.1 was downloaded from its official GitHub release. The Windows
x64 archive matched the previously pinned official SHA-256:
`D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E`.

Generic credential-signature review found only documented placeholders and
demonstration passwords such as the existing Browser Use environment-variable
example and neutral demo configuration. No usable credential was present.

## Functional and beginner-install assurance

Validation used:

- Node.js 24.15.0;
- npm 11.12.1;
- Go 1.24.2.

Both the final extracted ZIP and a fresh clone of the clean bundle passed:

- lockfile installation with `npm ci`;
- setup flow: 6/6 steps;
- doctor: pass;
- JobFinder health: 11/11;
- unit safety and pipeline tests: 48/48;
- complete product suite: 93/93, 0 warnings;
- dashboard reproducible compilation: pass;
- pipeline verification: 0 errors, 0 warnings.

The setup test used `-SkipBrowser` because Playwright Chromium was already
installed. Doctor independently confirmed that Chromium was available. The
default beginner `setup.bat` path still installs Chromium when it is absent.

The final beginner ZIP contains:

- 204 files;
- 41 directories;
- exactly one executable:
  `dashboard/career-dashboard-live.exe`;
- dashboard executable size: 5,061,632 bytes;
- release notes;
- neutral local bootstrap files copied from public templates.

## v1.4.0 engineering scope

The release includes the canonical development foundation:

- least-privilege CI with pinned official setup actions;
- complete-history Gitleaks scanning;
- full unit safety suite in product health;
- deterministic normalization and identity regressions.

It also corrects a SuccessFactors source-health false positive. A current,
public Minsait/Indra Portugal listing exposes server-rendered `/job/` links and
the existing generic HTML scanner accepted six matching jobs in a no-write
live test.

The detector now reports such listings as `generic_html/existing`.
SuccessFactors pages without usable server-rendered job links remain
`successfactors/needed`.

No new adapter, browser requirement, API credential, dependency or external
write capability was added.

## Source-health evidence

The final live audit checked 184 active sources:

- 158 healthy;
- 14 dead URLs;
- 7 fetch failures;
- 5 blocked;
- 0 requiring a new adapter.

The snapshot, local source list and cleanup report remain User Layer evidence
and are intentionally absent from release artifacts.

## Licensing

No JobNavigator or SAP source code was copied for the SuccessFactors
classification. No new third-party attribution is required.

The existing MIT attribution for the Eightfold protocol remains in
`THIRD_PARTY_NOTICES.md`.

## Residual boundaries

- No artifact was pushed or published to an external service.
- The canonical development repository has no remote, but its developer
  metadata is not the approved source-distribution artifact.
- The clean bundle and beginner ZIP are the only approved v1.4.0 artifacts.
- Users add their own personal information only after installation.
- Live career-site structure and access policy can change independently of
  this release.
