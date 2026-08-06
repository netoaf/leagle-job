# Internal Assurance Attestation

Attestation date: 2026-07-23

## Scope

This attestation covers the JobNavigator source tree acquired from
`https://github.com/vesaias/JobNavigator` at exactly:

`387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`

It also covers the JobFinder research evidence and synthetic prototype
contracts produced during this intake.

## Attested results

Based on the recorded evidence:

1. The acquisition was isolated, provenance-bound and performed without
   executing upstream code, hooks, dependencies, containers or migrations.
2. The clone was clean, its Git object check returned no errors, and push was
   disabled.
3. No personal credentials or personal contact data were introduced into the
   created analysis and prototype files.
4. The plan and evidence structure align with the selected NIST SSDF, OWASP
   SCVS, SLSA provenance and OpenSSF Scorecard practices.
5. The static security, supply-chain, architecture and component reviews are
   sufficient to support the recorded decisions and limitations.
6. The research base is suitable for planning clean, synthetic, component-level
   experiments.
7. The upstream runtime is not approved for installation, execution or
   integration.
8. No JobNavigator source is approved for direct copying into JobFinder without
   a separate plan, attribution decision, threat review and green JobFinder
   gates.

## Disposition

- Intake process: **PASS**
- Provenance and isolation: **PASS**
- Static-analysis continuation: **PASS**
- Synthetic research-base readiness: **PASS**
- Upstream runtime execution: **NO-GO**
- Direct integration into JobFinder: **NO-GO**
- Future focused planning: **GO**, beginning with the outbound URL-safety
  boundary

## Qualification

This is an internal engineering assurance statement, not an accredited
security certification, legal opinion or guarantee that the software is free
of vulnerabilities.

It is valid only for the recorded commit, evidence files, date and limitations.
It must be reissued if:

- the upstream commit changes;
- the clone is modified;
- dependencies are resolved or installed;
- containers or external integrations are enabled;
- real data or credentials are introduced;
- a component is promoted into the JobFinder codebase.

The controlling technical record is `07-FINAL-INTAKE-REPORT.md`.
