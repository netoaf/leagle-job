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
  -> optional local discovery-provenance write
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

Record that a vacancy was discovered through a named lane after its official
URL has been verified:

```bash
npm run evaluate-url -- --url "https://company.example/careers/job/42" --discovered-via LinkedIn --write
```

`--discovered-via` accepts `LinkedIn`, `Indeed`, `IEFP Online`, `ITJobs` and
`Net-Empregos`. It is intentionally explicit: the tool does not infer the
discovery lane from an employer/ATS URL.

Debug with a visible browser:

```bash
npm run evaluate-url -- --url "https://example.com/job" --visible
```

## Outputs

When `--write` is used, files are saved under:

```text
output/evaluate-url/
```

When a supported `--discovered-via` value is combined with `--write` or
`--dashboard`, Leagle Job also updates its local ignored evidence ledger:

```text
data/source-captures.tsv
```

That record keeps the declared discovery lane and the verified official URL
separate. It has no CV, account, form, recruiter or browser-session data.

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
- An unsupported `--discovered-via` value fails before extraction or dashboard
  promotion.
- Discovery provenance is stored before a dashboard write. A failed local
  provenance write prevents that dashboard write instead of claiming coverage
  it could not preserve.
- A low-quality or low-fit vacancy may prove that discovery worked, but it
  never counts as qualified coverage.
- The browser agent is extraction-only.
- API keys are not used or stored.
- A URL already present in `data/pipeline.md` can still be promoted if it does
  not already have a report or dashboard row.
