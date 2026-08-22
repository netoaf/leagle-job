# Leagle Job v1.4.1

Release date: 2026-08-22

## Outcome

This maintenance release makes the local security scan reliable in isolated
Windows checkouts and updates the engineering priorities to distinguish a
validated local baseline from an intentionally published release.

## Improvements

- `npm run security:scan` now passes Git's `safe.directory` setting only to
  the Gitleaks child process. It does not change the user's global Git
  configuration.
- A Windows contract test proves that the security scan provides the scoped
  trust value to its scanner process.
- Current-status documentation now prioritises a sanitized package, explicit
  source-health versus market-coverage evidence, and recoverable persistence.

## Verification

- Product suite: 98 passed, 0 failed, 0 warnings.
- Product health: 15/15 checks passed.
- Pipeline reconciliation: 0 errors, 0 warnings.
- Production dependency audit: 0 vulnerabilities.
- Redacted Gitleaks scan: 16 Git commits scanned, no leaks found.

## Privacy and safety

- No User Layer file, CV, report, tracker entry, credential or personal source
  configuration is included in the package.
- No email send, portal submission, CV upload or automatic application action
  is added by this release.
- This release is local until a user deliberately chooses to publish it.
