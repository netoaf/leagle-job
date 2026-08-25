# Mode: controlled pipeline intake

Use this mode to route an explicit vacancy through Leagle Job's existing
pipeline. Read `modes/_shared.md` first.

## Supported paths

- One URL, no write: `npm run evaluate-url -- --url "https://example.com/job"`
- One URL, controlled promotion: `npm run evaluate-url:dashboard -- --url "https://example.com/job"`
- Portugal-first discovery preview: `npm run leagle:new:dry-run -- --limit 80`
- Small controlled write: `npm run leagle:new -- --limit 80 --write-limit 5`

## Required flow

```text
source evidence
  -> normalization and identity
  -> quality gate
  -> deduplication
  -> deterministic 0--100 score
  -> report/tracker through the supported pipeline
  -> human review
```

Do not bypass the quality gate, dedupe or canonical tracker states. Do not
claim broad source coverage from configuration alone.

## Application preparation

For a strong, live vacancy, generate a pack and validate it before any external
action:

```powershell
npm run application-pack -- --id <application-id>
npm run draft-quality
```

Preparation creates review material. It does not submit, send or upload.
Optional Gmail and portal paths require the separate documented preflight and
must fail closed when unavailable.
