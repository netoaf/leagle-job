# Leagle Job Browser Agent

Leagle Job has a safe local browser agent for extraction-only workflows.

It uses Playwright, which is already part of the project dependencies. It does
not use BrowserUse cloud, does not store API keys and does not submit
applications.

## What It Can Do

- Open a job URL in a local browser context.
- Extract visible page text.
- Extract `JobPosting` JSON-LD when present.
- Detect forms and application links without clicking them.
- Normalize the page into a compatible internal job object.
- Optionally score the extracted job against `config/profile.yml` and
  `config/scoring.yml`.
- Optionally write extraction artifacts to `output/browser-agent/`.

## What It Must Not Do

- Fill application forms.
- Upload CVs.
- Send emails.
- Click submit/apply buttons.
- Store API keys.
- Replace human review.

## Commands

Check the safety policy:

```bash
npm run browser-agent:check
```

Extract and score a job page without writing files:

```bash
npm run browser-agent:score -- --url "https://example.com/job"
```

Extract, score and write artifacts:

```bash
npm run browser-agent:score -- --url "https://example.com/job" --write
```

Open a visible browser for debugging:

```bash
npm run browser-agent:score -- --url "https://example.com/job" --visible
```

## Config

The safety and provider config lives in:

```text
config/browser-agent.yml
```

The default provider is `playwright_local`.

The scanner integration is also configured there. It is intentionally limited
to explicit sources:

```yaml
scanner:
  enabled: true
  use_only_when_adapter_is_browser_agent: true
  write_outputs_from_scanner: false
```

Use it in `portals.yml` only for high-value job pages that need a rendered
browser extraction:

```yaml
tracked_companies:
  - name: Example Company
    careers_url: https://example.com/jobs/junior-developer
    adapter: browser_agent
    enabled: true
```

Do not use `adapter: browser_agent` for broad career listings unless that page
represents one specific vacancy. Normal listings should keep using their
dedicated adapter or `generic_html`.

BrowserUse cloud is represented in the config as a disabled future provider.
If it is ever enabled, its API key must stay in `.env` or the local shell
environment, never in the repository.

## Integration Position

Recommended flow:

```text
job URL
  -> browser-agent extraction
  -> normalized job object
  -> quality gate
  -> scoring
  -> report/draft
  -> human review
  -> manual application
```

The browser agent is an extraction adapter, not an auto-apply system.
