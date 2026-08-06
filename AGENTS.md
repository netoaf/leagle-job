# Leagle Job for Codex

Read `CLAUDE.md` for all project instructions, routing, and behavioral rules.
They apply equally to Codex.

When working on Leagle Job, use the Obsidian vault as the orientation
layer when it exists:

- `../obsidian_vault/00 - Home.md`
- `../obsidian_vault/01 - AI Development Index.md`
- the specific vault note for the area being changed

Key points:

- Reuse the existing modes, scripts, templates, and tracker flow. Do not create parallel logic.
- Store user-specific customization in `config/profile.yml`, `config/scoring.yml`, `config/jobfinder-rules.yml`, `modes/_profile.md`, or `article-digest.md`. Never put it in `modes/_shared.md`.
- The Obsidian vault guides humans and agents, but the source of truth remains the live Leagle Job files in `config/`, `data/`, `reports/`, and `output/`.
- Leagle Job is based on Career-Ops. Preserve the original MIT license,
  citation, upstream links and author attribution. Read `BRANDING.md` before
  changing names; legacy technical names remain supported for compatibility.
- Never submit an application, send an email, or upload a CV on the user's behalf.

For Codex-specific setup, see `docs/CODEX.md`.
