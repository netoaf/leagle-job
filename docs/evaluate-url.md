# Leagle Job Evaluate URL

`evaluate-url` is the safe single-URL workflow.

It connects the local browser agent to the existing Leagle Job pipeline:

```text
job URL
  -> browser-agent extraction
  -> normalized job object
  -> enrichment
  -> quality gate
  -> scoring against config/profile.yml
  -> optional artifact write
  -> optional dashboard/report write
```

It does not submit applications, fill forms, upload CVs or send emails.

## Commands

Preview a job URL:

```bash
npm run evaluate-url -- --url "https://example.com/job"
```

Save extraction and scoring artifacts:

```bash
npm run evaluate-url -- --url "https://example.com/job" --write
```

Promote a selected job to the dashboard and generate a report:

```bash
npm run evaluate-url -- --url "https://example.com/job" --write --dashboard
```

Debug with a visible browser:

```bash
npm run evaluate-url -- --url "https://example.com/job" --visible
```

## Outputs

When `--write` is used, files are saved under:

```text
output/evaluate-url/
```

When `--dashboard` is used and the job passes quality/scoring thresholds,
Leagle Job writes the normal report to:

```text
reports/
data/applications.md
data/pipeline.md
data/scan-history.tsv
data/job-index.jsonl
```

## Safety Rules

- Human review remains required.
- `--dashboard` only promotes selected jobs.
- The browser agent is extraction-only.
- API keys are not used or stored.
- A URL already present in `data/pipeline.md` can still be promoted if it does
  not already have a report or dashboard row.
