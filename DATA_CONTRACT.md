# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `cv.md` | Your CV in markdown |
| `config/profile.yml` | Your identity, targets, comp range |
| `config/scoring.yml` | Your scoring scale, weights, thresholds, blockers |
| `config/jobfinder-rules.yml` | Your critical safety/privacy/no-invention rules |
| `config/email.yml` | Your local email draft policy and Gmail integration settings |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `portals.yml` | Your customized company list |
| `data/applications.md` | Your application tracker |
| `data/application-actions.tsv` | Your local action/channel tracker before applying |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history |
| `data/email-drafts.tsv` | Your local email draft tracker |
| `data/gmail-events.tsv` | Idempotent sent/reply events imported from Gmail |
| `data/application-followups.tsv` | Follow-up dates, Gmail thread IDs and recommended next actions |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated PDFs |
| `jds/*` | Your saved job descriptions |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/de/*` | German language modes |
| `CLAUDE.md` | Agent instructions |
| `AGENTS.md` | Codex instructions |
| `*.mjs` | Utility scripts |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `config/scoring.example.yml` | Neutral scoring template copied to the User Layer during setup |
| `config/jobfinder-rules.example.yml` | Neutral safety/rules template copied to the User Layer during setup |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |

## The Rule

**If a file is in the User Layer, an update or release process must never
modify, delete, bundle, publish or transmit it.** Runtime commands may read the
user configuration and work product they need in order to operate locally.

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**

## Local operational notes

Files matching `docs/*-AUDIT-*.md` and `docs/superpowers/` are ignored local
working notes. They can contain vacancy, recipient, tracker or planning context
and are not product documentation or release material. Keep durable,
product-wide guidance in checked-in `docs/`; keep user-specific evidence in the
User Layer.
