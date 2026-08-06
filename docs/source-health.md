# Leagle Job Source Health

This document explains how to audit the career sources configured in
`portals.yml`.

## Command

Run a full audit:

```bash
npm run portals:audit
```

Audit only one company/source:

```bash
npm run portals:audit -- --source Blip
```

Audit a small sample:

```bash
npm run portals:audit -- --limit 10
```

Audit Portugal-priority sources first:

```bash
npm run portals:audit -- --group portugal
```

Tune concurrency when needed:

```bash
npm run portals:audit -- --concurrency 4
```

The full command writes:

```text
data/source-health.tsv
```

Generate a safe cleanup plan from the latest source-health data:

```bash
npm run source-health:cleanup
```

This writes:

```text
reports/source-health-cleanup.md
```

It does not edit `portals.yml` automatically.

Filtered or limited audits are intentionally safe. They write to:

```text
reports/source-health-preview.tsv
```

This prevents a small sample from overwriting the canonical source health file.
Use `--dry-run` to avoid writing any file, `--out <path>` for a custom path, or
`--replace` only when you deliberately want a filtered audit to replace
`data/source-health.tsv`.

The auditor uses low, bounded concurrency. The default is `4` parallel checks
and the hard maximum is `8`, to keep the scan respectful and avoid noisy
traffic.

## Output Fields

`data/source-health.tsv` contains:

- `company`: company/source name from `portals.yml`.
- `group`: inferred group such as `portugal_priority`, `portugal_general`,
  `remote_europe` or `global`.
- `url`: configured career URL shown to the user.
- `checked_url`: URL actually checked by the auditor. When a stable API is
  configured in `portals.yml`, this can be the API URL because it is the real
  scanner input.
- `enabled`: whether the source is active in `portals.yml`.
- `status`: current health classification.
- `http_code`: HTTP status returned by the source.
- `final_url`: final URL after redirects.
- `detected_adapter`: adapter inferred from URL or page content.
- `adapter_status`: `existing` if Leagle Job already has support, `needed` if a
  dedicated adapter should be added.
- `error`: network or fetch error, when present.
- `last_checked`: audit timestamp.
- `next_action`: recommended engineering action.

## Status Meanings

- `healthy`: source responded and can use an existing adapter or generic HTML
  fallback.
- `needs_adapter`: source responded, but its current public surface still needs
  a dedicated adapter. The scanner already supports Workday, SmartRecruiters,
  Teamtailor, Workable and Eightfold. SuccessFactors listings that expose
  usable server-rendered `/job/` links use the existing generic HTML scanner;
  JavaScript-only SuccessFactors listings remain `needs_adapter`.
- `dead_url`: source returned `404` or `410`; update the URL or disable it.
- `blocked`: source returned `401` or `403`; use Playwright fallback or mark as
  manual watch.
- `rate_limited`: source returned `429`; add cache/backoff and retry later.
- `fetch_failed`: the request failed or timed out; retry with network access,
  then consider Playwright fallback.
- `server_error`: source returned `5xx`; retry later before changing config.
- `redirect`: source redirected; check if `final_url` is stable and update
  `portals.yml` if useful.

## How To Use It

Recommended workflow:

1. Run `npm run portals:audit -- --dry-run --limit 20` to test connectivity.
2. Run `npm run portals:audit` when you want to refresh the canonical health
   file.
3. Fix obvious `dead_url` sources first.
4. Add or improve adapters for repeated `needs_adapter` sources.
5. Add Playwright fallback only for sources that are valuable and blocked.
6. Re-run `npm run jobfinder:pt:dry-run -- --limit 30`.

Do not disable a high-value source just because it is blocked once. Prefer
checking the URL in a browser or retrying another day before removing it.

## Adapter Hints In `portals.yml`

Use `adapter:` when the auditor can identify the platform but the URL is not
obvious from the domain:

```yml
- name: Critical TechWorks
  careers_url: https://join.criticaltechworks.com/jobs
  adapter: teamtailor
```

Use `adapter: browser` only for valuable sources where plain `fetch` is blocked,
empty or incomplete but a rendered browser page exposes usable job links:

```yml
- name: OutSystems
  careers_url: https://www.outsystems.com/careers/job-list/
  adapter: browser
  scan_pages: 8
```

For an Eightfold listing, use its dedicated adapter. It caps pagination at five
pages, does not sign in or interact with application forms, and obtains each
selected description only from the public API on the rendered page's own
origin:

```yml
- name: Example Eightfold Company
  careers_url: https://company.example/careers
  adapter: eightfold
  scan_pages: 2
```

For Workday, prefer an explicit CXS API when confirmed:

```yml
- name: Accenture Portugal
  careers_url: https://www.accenture.com/pt-pt/careers
  api: https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/AccentureCareers/jobs
  adapter: workday
```

If no stable API is known, keep the source as `needs_adapter` or use manual
watch instead of adding fragile guesses.

For Workable custom career pages, use an explicit adapter when the page exposes
public Workable metadata through `/_/llms.txt` or `apply.workable.com`:

```yml
- name: Critical Manufacturing
  careers_url: https://careers.criticalmanufacturing.com/
  adapter: workable
```
