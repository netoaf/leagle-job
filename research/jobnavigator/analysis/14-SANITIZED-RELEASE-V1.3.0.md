# JobFinder v1.3.0 Sanitized Release Attestation

Execution date: 2026-07-23

## Decision

**APPROVED for local distribution.**

This approval applies only to the two v1.3.0 artifacts named below. It does
not approve the older outer repository or its historical commits for
publication.

## Release artifacts

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `JobFinder-v1.3.0.zip` | 11,892,561 | `98B4966B51DFB1D501639A4F6940B13F4DAAE3C53E4F952B290BDC0FB6C2C00F` |
| `JobFinder-v1.3.0-clean.bundle` | 9,099,597 | `2B8B05C100FA2C898B6789F8FB251596981E4344A2FE624EB05AE7B714E08E6D` |

`JobFinder-v1.3.0-SHA256SUMS.txt` contains the same checksums for independent
verification.

## Source identity and provenance

- branch: `main`;
- tag: `v1.3.0`;
- release commit:
  `8f4352ea8df29a0191d7c2f40a90f53ea37f6f40`;
- release tree:
  `514c46a91a3ea57ea73010dd86c1baf0febe5ab0`;
- parent sanitized baseline:
  `fe71d4ff66d388626be144667a9876b3170d00ed`;
- commits in complete sanitized history: 3;
- tracked files: 212;
- remotes at bundle creation: 0;
- symlinks: 0;
- submodules: 0;
- `git fsck --strict --no-reflogs`: pass with no messages;
- `git bundle verify`: complete history;
- a fresh clone of the bundle reproduced the exact release commit and tree.

The Eightfold protocol knowledge was adapted from JobNavigator revision
`387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`. The exact source paths,
modifications and full MIT notice are recorded in
`THIRD_PARTY_NOTICES.md`. No JobNavigator database, API, UI, scheduler,
authentication, extension, scoring system or external integration was
promoted.

## Privacy and secret assurance

Ten private markers were derived from the active local User Layer without
printing their values. Neutral template markers were removed before scanning.

- private marker matches in the bundle worktree: 0;
- private marker matches in the extracted ZIP: 0;
- credential-signature matches: 0;
- absolute local user-path matches: 0;
- forbidden User Layer paths tracked in Git: 0;
- forbidden development/private paths in the ZIP: 0;
- neutral bootstrap copies: 7/7 exact template matches;
- Gitleaks complete-history findings: 0;
- Gitleaks extracted-ZIP findings: 0.

Gitleaks 8.30.1 was downloaded from its official GitHub release. The Windows
x64 archive matched both the official checksum file and the previously pinned
SHA-256:
`D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E`.

The ZIP intentionally contains neutral local bootstrap files such as `cv.md`,
`portals.yml` and `config/profile.yml`. They are exact copies of public
templates and contain no user credentials or personal information.

## Functional and beginner-install assurance

Validation used Node.js 24.15.0, npm 11.12.1 and Go 1.24.2.

- lockfile installation with `npm ci`: pass;
- setup flow: 6/6 steps;
- Eightfold and network-safety unit tests: 24/24;
- quick product suite: 92/92, 0 warnings;
- complete product suite: 93/93, 0 warnings;
- dashboard reproducible compilation: pass;
- JobFinder health: 11/11;
- doctor: pass;
- pipeline verification: 0 errors, 0 warnings;
- neutral bootstrap files after setup: 7/7 unchanged;
- packaged dashboard: exactly one `.exe`, 5,061,632 bytes;
- packaged files/directories: 199/39.

The final ZIP was built from the sanitized release commit, extracted into a
new directory, installed and tested there. The setup test used
`-SkipBrowser` because Playwright Chromium was already installed; the default
`setup.bat` path remains responsible for installing Chromium for a new user.

## Release issue found and resolved

The first fresh-ZIP test exposed a pre-existing portability defect:
`test-all.mjs` inherited Git metadata from a parent repository and incorrectly
reported synthetic examples as ignored.

The release was stopped, the test was changed to run repository-history and
tracking checks only when the package root is the actual Git top-level, and
all artifacts were rebuilt. The corrected ZIP then passed 92 quick and 93
complete checks with no warnings outside its source repository.

The six Windows `.bat` launchers are stored with CRLF line endings in the
sanitized checkout, as required by the repository attributes. Their normalized
content was confirmed equal to the active source before the sanitized package
was selected.

## Included adapter safety boundary

The Eightfold adapter:

- accepts credential-free HTTPS sources only;
- derives detail APIs on the exact configured origin;
- uses the central `safeFetch` boundary;
- caps listing pagination at five pages and collected links at 100;
- applies title filters before detail requests;
- caps redirects, time, response size and description size;
- disables service workers and blocks image, media and font requests;
- does not sign in, fill forms, upload CVs, send messages or submit
  applications.

## Beginner handoff

1. Verify `JobFinder-v1.3.0.zip` against the SHA-256 manifest.
2. Extract the ZIP.
3. On Windows, run `setup.bat`.
4. Open `COMECE-AQUI.md` and edit only the local template copies.

The source bundle is intended for Git inspection and development. The ZIP is
the recommended beginner artifact.

## Previous release preservation

The approved v1.2.0 artifacts remain present and unchanged:

- ZIP SHA-256:
  `1B3EF1579445E2BBB346ECA5F52F5D2E45922405C8493193590CDE11C2DD6E4F`;
- clean bundle SHA-256:
  `E123B47014C38DF7A311C35F371FEAE3AC6148EEE990BCA97A49C64EB2C755EB`.

## Residual boundaries

- No artifact was pushed or published to an external service.
- The ZIP contains software and neutral examples only; users must add their
  own information locally after installation.
- The unsafe outer repository history must still not be pushed.
- Live job-source behavior can change independently of this release; the
  bounded adapter fails closed on invalid origin, content type or payload.
