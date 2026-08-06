# Leagle Job Application Packs

Application packs transform evaluated jobs into review-ready application
material. They do not send emails, upload CVs or submit forms.

## Commands

Preview the top 10 actionable applications:

```bash
npm.cmd run application-pack:dry-run
```

Generate packs for the top 10:

```bash
npm.cmd run application-pack
```

Generate packs plus one execution checklist:

```bash
npm.cmd run top10-action
```

Generate packs for specific tracker IDs:

```bash
npm.cmd run application-pack -- --id 2,8,11
```

Generate fewer packs:

```bash
npm.cmd run application-pack -- --top 3
```

Validate generated email drafts:

```bash
npm.cmd run draft-quality
```

Prepare local email drafts after review:

```bash
npm.cmd run email-drafts -- --top 10
```

Prepare action/channel rows:

```bash
npm.cmd run application-actions -- --top 10
```

Generate safe CV tailoring diffs before any tailored PDF:

```bash
npm.cmd run cv-tailor-diff -- --top 10
```

## Output

Packs are written to:

```text
output/application-packs/
```

Each pack includes:

- tracker details;
- rule-based preselected CV PDF path;
- CV language/variant and the reason for the choice;
- original CV-library path;
- report path;
- safe candidate evidence from `config/candidate-context.yml`;
- evidence bank path;
- confirmation checklist;
- CV adjustments;
- email draft;
- recruiter questions;
- red flags;
- hard blockers;
- privacy checklist;
- follow-up plan.
- a Top 10 action plan when using `top10-action`.
- a local email draft can be generated separately with `email-drafts`.

The generator also repairs common mojibake inherited from older reports when
building the pack output, so text such as Portuguese accents stays readable in
the final review artefact.

Generated packs are not considered ready for use until
`npm.cmd run draft-quality` passes.

## CV Library And Rule-Based Preselection

The six base CV PDFs are configured in:

```text
config/profile.yml
```

Fields:

```yml
documents:
  cv_library:
    pt:
      backend: "output/cv-library/PT/CV-AfonsoNeto-PT-Backend.pdf"
      fullstack: "output/cv-library/PT/CV-AfonsoNeto-PT-Fullstack.pdf"
      automation_qa: "output/cv-library/PT/CV-AfonsoNeto-PT-Automation-QA.pdf"
    en:
      backend: "output/cv-library/EN/CV-AfonsoNeto-EN-Backend.pdf"
      fullstack: "output/cv-library/EN/CV-AfonsoNeto-EN-Fullstack.pdf"
      automation_qa: "output/cv-library/EN/CV-AfonsoNeto-EN-Automation-QA.pdf"
```

For each application pack, Leagle Job estimates PT/EN and Backend/Full-stack/
Automation-QA from the role, tracker notes and source report. This is a
rule-based preliminary choice, not a guarantee that the CV is the best match.
It copies the chosen PDF to:

```text
output/application-packs/cvs/
```

The tracker notes can override a wrong automatic choice with `[cv:pt]`,
`[cv:en]`, `[cv:backend]`, `[cv:fullstack]` or `[cv:automation-qa]`.

`cv.md` remains the textual context for scoring, reports and tailoring notes.
The selected PDF is still only a candidate-facing document for a manual
application. Selection does not authorize upload or submission.

## Safety Rules

- Always review the pack before applying.
- Never send automatically.
- Never upload a CV automatically.
- Never invent missing experience, certificates, projects, metrics, links or
  clients.
- Anything uncertain must stay as `a confirmar`.
- Lurien is a confirmed private project name. It may be mentioned, but private
  code, tokens, identifiers and runtime data must not be exposed; use a
  controlled demo or technical description.
- If a report draft conflicts with `data/candidate-evidence.md`, trust the
  evidence bank and rewrite the draft before sending.
- If `npm.cmd run draft-quality` fails, do not use the draft.
- If `data/email-drafts.tsv` says `needs_recipient`, confirm the recruiter/company email before creating a Gmail draft.
- If a CV tailoring diff has not been reviewed, do not generate/send a tailored CV.
