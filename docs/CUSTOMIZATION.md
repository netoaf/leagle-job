# Customization Guide

## Profile And Candidate Context

Leagle Job separates operational profile data from reusable evidence.

Use these files in this order:

1. `config/profile.yml` - operational profile used by scripts.
2. `config/candidate-context.yml` - structured, reusable context for scoring,
   messages, project framing and search strategy.
3. `data/candidate-evidence.md` - human-readable evidence bank for reviewing
   what can be safely claimed.
4. `modes/_profile.md` - prompt-facing summary for AI-assisted workflows.

If a detail is not confirmed in these files, keep it as `a confirmar`.

## Profile (`config/profile.yml`)

This is the operational identity file used by scripts. Keep it aligned with
`config/candidate-context.yml` and `data/candidate-evidence.md`.

Key sections:
- **candidate**: Name, email, phone, location, LinkedIn, portfolio
- **target_roles**: Your North Star roles and archetypes
- **narrative**: Your headline, safe story and proof points
- **compensation**: Target range, minimum, currency
- **location**: Country, timezone, visa status, on-site availability

## Candidate Context (`config/candidate-context.yml`)

Use this file to tune the system without touching code:

- **positioning**: junior/intern framing and forbidden positioning.
- **confirmed_profile**: education, location, languages and CV PDF.
- **target_roles**: primary, secondary and avoid roles.
- **confirmed_skills**: skills that can be safely mentioned.
- **projects**: confirmed projects, safe descriptions and forbidden claims.
- **messaging**: safe PT/EN intro lines and conservative project lines.
- **search_strategy**: companies, keywords and locations to prioritize.
- **confirmation_needed**: details that must remain `a confirmar`.

Do not put API keys, private links, tokens, credentials, full address, NIF,
citizen card data or private code here.

## Evidence Bank (`data/candidate-evidence.md`)

This is the review-friendly version of the candidate context. Use it before
sending applications to check that a draft:

- does not invent experience;
- does not overstate seniority;
- does not expose private project details;
- marks unknowns as `a confirmar`;
- uses Portuguese from Portugal for Portuguese companies and English for
  international/remote applications.

## Target Roles (modes/_shared.md)

The archetype table in `_shared.md` determines how offers are scored and CVs are framed. Edit the table to match YOUR career targets:

```markdown
| Archetype | Thematic axes | What they buy |
|-----------|---------------|---------------|
| **Your Role 1** | key skills | what they need |
| **Your Role 2** | key skills | what they need |
```

Also update the "Adaptive Framing" table to map YOUR specific projects to each archetype.

## Portals (portals.yml)

Copy from `templates/portals.example.yml` and customize:

1. **title_filter.positive**: Keywords matching your target roles
2. **title_filter.negative**: Tech stacks or domains to exclude
3. **search_queries**: WebSearch queries for job boards (Ashby, Greenhouse, Lever)
4. **tracked_companies**: Companies to check directly

## CV Template (templates/cv-template.html)

The HTML template uses these design tokens:
- **Fonts**: Space Grotesk (headings) + DM Sans (body) -- self-hosted in `fonts/`
- **Colors**: Cyan primary (`hsl(187,74%,32%)`) + Purple accent (`hsl(270,70%,45%)`)
- **Layout**: Single-column, ATS-optimized

To customize fonts/colors, edit the CSS in the template. Update font files in `fonts/` if switching fonts.

## Negotiation Scripts (modes/_shared.md)

The negotiation section provides frameworks for salary discussions. Replace the example scripts with your own:
- Target ranges
- Geographic arbitrage strategy
- Pushback responses

## Hooks (Optional)

Career-ops can integrate with external systems via Claude Code hooks. Example hooks:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "echo 'Career-ops session started'"
      }]
    }]
  }
}
```

Save hooks in `.claude/settings.json`.

## States (templates/states.yml)

The canonical states rarely need changing. If you add new states, update:
1. `templates/states.yml`
2. `normalize-statuses.mjs` (alias mappings)
3. `modes/_shared.md` (any references)
