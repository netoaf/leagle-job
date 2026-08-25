# Leagle Job v1.4.1

Status: release candidate

Candidate verified: 2026-08-25

## Outcome

This maintenance candidate protects canonical source evidence during broad
network outages, makes the local security scan reliable in isolated Windows
checkouts, persists reliable source-run signals and reconciles the documented
release state with verified output.

## Improvements

- `npm run security:scan` now passes Git's `safe.directory` setting only to
  the Gitleaks child process. It does not change the user's global Git
  configuration.
- A Windows contract test proves that the security scan provides the scoped
  trust value to its scanner process.
- Source-health writes now use same-directory atomic replacement. A complete
  audit with at least 20 checks and at least 80% environment-level transport
  failures preserves the canonical TSV, writes only preview evidence and exits
  non-zero.
- The canonical-path guard is case-insensitive on Windows, so alternate path
  casing cannot bypass the environment-failure protection.
- Real canonical scans now persist a sanitized per-source run ledger. It
  separates acquisition, capture, quality and fit; alerts after three
  comparable failures or empty acquisitions; and never advances a source
  streak during a broad environment outage.
- Product leak/path checks inspect the publishable Git surface while separate
  privacy gates continue to require local User Layer paths to remain ignored.
- Current-status and architecture documentation now match the release
  candidate's verified commands and file layout.
- Ephemeral browser snapshots are explicitly ignored to prevent rendered
  vacancy-page content from entering a release by accident.

## Verification

- Product suite: 101 passed, 0 failed, 0 warnings.
- Node unit suite: 144 passed, 0 failed.
- Product health: 16/16 checks passed.
- Pipeline reconciliation: 0 errors, 0 warnings across 137 tracker entries.
- Production dependency audit: 0 vulnerabilities.
- Redacted Gitleaks scan: 24 Git commits scanned, no leaks found.

## Privacy and safety

- No User Layer file, CV, report, tracker entry, credential or personal source
  configuration is included in the package.
- No email send, portal submission, CV upload or automatic application action
  is added by this release.
- This candidate remains local until a user deliberately authorizes its
  publication through a reviewed pull request.
