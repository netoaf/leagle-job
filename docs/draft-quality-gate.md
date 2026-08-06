# Leagle Job Draft Quality Gate

`draft-quality-gate.mjs` validates application-pack email drafts before any
manual application is sent.

It is deterministic and local. It does not use paid APIs, external AI, Gmail or
browser automation.

## Commands

Validate all generated application packs:

```powershell
npm.cmd run draft-quality
```

Validate one pack:

```powershell
npm.cmd run draft-quality -- --file output/application-packs/002-santander-gen-ai-trainee-program.md
```

Print machine-readable output:

```powershell
npm.cmd run draft-quality:json
```

## What It Blocks

The gate fails with exit code `1` when a draft contains high-risk issues:

- seniority exaggeration;
- forbidden claims;
- broad or unconfirmed AI/cloud/devops claims;
- unconfirmed links;
- phone number when phone is not confirmed for applications;
- portfolio/demo link when not confirmed;
- wrong language for the company context;
- missing confirmation request when the pack still has unresolved details;
- missing human-review / no-auto-send safety text.

Warnings do not fail the command, but should still be reviewed.

## Language Rules

- Portuguese-context companies use Portuguese from Portugal.
- International/default-English companies use English.
- Ambiguous cases should be reviewed manually.

The gate is intentionally conservative: if it is unsure, it warns; if it has a
strong signal, it blocks.

## Source Of Truth

The validator reads:

- `config/profile.yml`
- `config/candidate-context.yml`
- `config/jobfinder-rules.yml`
- `data/candidate-evidence.md` indirectly through the pack

If a draft conflicts with the evidence bank, rewrite the draft rather than
weakening the gate.

## Correct Workflow

1. Generate packs:

```powershell
npm.cmd run application-pack -- --top 10
```

2. Validate drafts:

```powershell
npm.cmd run draft-quality
```

3. Fix any errors in the source report or regenerate the pack.

4. Review manually.

5. Apply manually only after explicit approval.
