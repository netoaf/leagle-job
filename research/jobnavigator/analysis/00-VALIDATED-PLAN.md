# Validated Third-Party Intake Plan

## Decision

Proceed with an isolated, read-only intake of `vesaias/JobNavigator`. Do not
merge, install or execute upstream code during the static analysis phases.

This is an investigation exception to JobFinder's consolidation policy, not an
authorization to add a large new tool.

## Assurance baseline

The plan is aligned with:

- NIST SP 800-218 SSDF: security requirements, protected development
  environments, provenance, risk and design decisions.
- OWASP Software Component Verification Standard (SCVS): inventory, SBOM,
  package management, component analysis and pedigree/provenance.
- SLSA provenance: bind conclusions and later artifacts to exact source
  revisions and documented build steps.
- OpenSSF Scorecard: inspect repository security signals such as dangerous
  workflows, pinned dependencies, security policy, maintenance, review and CI.
- JobFinder's local AI Agent Risk Controls and Professional Quality Gates.

Automated scores and scanners are evidence, not certification by themselves.
Every finding must retain command/tool, timestamp, target revision and limits.

## Gates

### Gate 0 — Context and authorization

- Read JobFinder instructions, architecture, data contract, risk controls,
  stabilization plan, decision log and quality gates.
- Record the dirty-worktree baseline without modifying or cleaning user files.
- Confirm the research area cannot enter the distributable JobFinder ZIP.

Pass condition: boundaries documented and current user work preserved.

### Gate 1 — Controlled acquisition

- Clone over HTTPS without submodules, tags or full history.
- Disable repository-local hooks for acquisition.
- Do not run Git LFS smudge, installers, package managers or containers.
- Record remote URL, default branch, commit SHA, object integrity and license
  hash.

Pass condition: clone origin and revision are reproducible and no code ran.

### Gate 2 — Static repository security

- Inspect GitHub Actions, Dockerfiles, Compose, install/start scripts, extension
  permissions, migrations, network endpoints and credential handling.
- Scan tracked files for likely secrets and private keys without printing secret
  values.
- Review security policy, contribution model, release practice and repository
  activity.

Pass condition: no critical unexplained behavior; risks classified.

### Gate 3 — Component and dependency inventory

- Inventory languages, services, direct dependency manifests, lockfiles,
  containers, ports, volumes and external services.
- Generate a machine-readable inventory/SBOM where tooling permits without
  installing or executing upstream code.
- Perform vulnerability and license analysis with explicit tool limitations.

Pass condition: direct/transitive exposure and licenses are understood well
enough to make a go/no-go decision on isolated execution.

### Gate 4 — Architecture and reuse analysis

- Map JobNavigator components to existing JobFinder modules and sources of
  truth.
- Mark each component: reject, idea-only, reimplement, adapt-with-attribution or
  evaluate-later.
- Reject parallel scoring, tracker or candidate-data sources unless a future
  architecture decision replaces the existing source of truth.

Pass condition: shortlist has value, owner boundary, risk and verification
strategy.

### Gate 5 — Isolated research base

- Prepare documentation, fixtures and prototype directories using synthetic
  data only.
- If static gates approve later execution, define a separate disposable
  environment with no JobFinder mounts and no real integrations.
- Stop before running that environment unless separately authorized.

Pass condition: next team can reproduce findings and begin a focused
integration plan without touching user data.

### Gate 6 — Final intake report

- Re-run privacy/path checks.
- Summarize provenance, license, security, dependencies, architecture,
  candidate components, rejected components and residual risks.
- Record all skipped checks and why.

Pass condition: evidence-backed handoff and explicit stop before integration.

## Stop conditions

Stop acquisition or analysis if:

- the target path resolves outside the research directory;
- the upstream URL or revision is inconsistent;
- submodules, hooks or package scripts begin executing;
- real credentials or personal data would be required;
- a critical secret/private key is present in tracked upstream content;
- analysis would mutate JobFinder's User Layer;
- destructive cleanup cannot be limited to the ignored research directory.

## Definition of done

The intake is complete only when provenance, license, repository security,
dependency inventory, architecture mapping and a component decision matrix are
documented, and JobFinder health/privacy boundaries remain unchanged.
