# Component and Supply-Chain Assessment

Target revision:
`387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`

Assessment date: 2026-07-23

## Gate 3 decision

**The static inventory is complete enough to make a decision: do not execute
the upstream stack.**

This is not a claim that every dependency is vulnerable. It means the exact
software that would be installed cannot be reproduced and verified from the
tracked repository alone.

## Inventory summary

- 227 tracked source files at acquisition.
- 64 backend production Python files and 89 Python test files.
- 16 frontend source files.
- 5 text/source files in the Chrome extension.
- 23 direct Python requirement entries.
- 8 frontend runtime and 7 frontend development dependency ranges.
- Four Compose services: database, backend, frontend and Caddy.
- Five mutable container inputs across the Dockerfiles and Compose file.

The machine-readable record is `04-COMPONENT-INVENTORY.json`.

## Reproducibility gaps

1. `frontend/package-lock.json` is absent and the Docker build uses
   `npm install`. The resolved dependency tree can change without a source
   commit.
2. Python packages have versions but no artifact hashes. `starlette`, `lxml`
   and `Jinja2` use lower bounds rather than exact versions.
3. `linkedin-api` comes from a maintainer-controlled GitHub fork. It is pinned
   to a commit, which is better than a branch, but requires separate license,
   provenance and integrity review.
4. Base images use mutable tags rather than immutable digests.
5. The backend Dockerfile downloads a NodeSource script and pipes it to
   `bash`, then globally installs an unversioned Claude Code package.
6. GitHub Actions use mutable major action tags rather than commit SHAs.

## Vulnerability evidence and limits

- The repository's own requirements and CI acknowledge an unresolved
  `markdownify` advisory inherited through `python-jobspy`.
- The CI dependency-audit job is advisory (`continue-on-error`) and ignores
  that advisory.
- The exact acquisition commit had no combined status contexts exposed by the
  GitHub API during this review.
- `pip-audit`, OSV Scanner, Syft, Trivy, Gitleaks, Semgrep and Bandit were not
  available locally. They were not installed because this phase forbids
  changing the toolchain or resolving upstream dependencies.
- Therefore this report does not claim that the listed dependencies are free
  of vulnerabilities.

## License conclusion

The top-level source is MIT licensed and the license file was hashed during
acquisition. MIT permits reuse and modification, but copied source must retain
the applicable copyright and permission notice.

The top-level license is not a substitute for a dependency-license SBOM.
Before any dependency or vendored source is introduced, its own license and
notices must be reviewed.

## Runtime exposure

The provided Compose configuration exposes the backend on port 8000, frontend
on 3000 and Caddy on 80/443 on all host interfaces. PostgreSQL alone is bound
to loopback. It mounts backend source, backups and a LinkedIn session
directory into containers.

Combined with plaintext credential storage and weak first-run defaults, this
is sufficient for a no-go decision on running the stack unchanged.

## Conditions for a future disposable run

A later plan may authorize a disposable run only after:

- generating Python and npm lockfiles from an explicitly reviewed process;
- pinning container images and GitHub Actions by immutable digest/SHA;
- removing remote-script piping and unversioned global installs;
- producing a dependency and license SBOM;
- making vulnerability checks blocking, with documented exceptions;
- binding all services to loopback and removing Caddy unless required;
- using random ephemeral secrets, never personal credentials;
- disabling LinkedIn, Jobright, Gmail, Telegram, tracing and LLM providers;
- mounting no JobFinder directory and loading synthetic data only.
