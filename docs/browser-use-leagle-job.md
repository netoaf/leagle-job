# Browser Use + Leagle Job

Browser Use is an optional external radar for hard searches. Leagle Job remains
the source of truth for dedupe, scoring, quality gate, dashboard and application
packs.

## Why Use It

Use Browser Use when normal adapters are not enough:

- broad deep searches across public job boards;
- websites that block simple fetch;
- discovery across Portuguese and English queries;
- one-off research briefs like `lisbon-tech-junior-brief.html`.

Do not use Browser Use for:

- auto-apply;
- sending emails;
- uploading CVs;
- storing credentials in the repo;
- replacing Leagle Job scoring.

## Security

Never store the Browser Use key in files.

PowerShell:

```powershell
$env:BROWSER_USE_API_KEY = "bu_..."
```

The repo only reads the key from the environment variable:

```text
BROWSER_USE_API_KEY
```

## Import Existing HTML Report

Dry run:

```powershell
npm.cmd run browser-use:import:dry-run -- --from-html "..\..\lisbon-tech-junior-brief.html"
```

Run official Leagle Job scoring on new candidates:

```powershell
npm.cmd run browser-use:rank -- --from-html "..\..\lisbon-tech-junior-brief.html"
```

This writes a snapshot to:

```text
output/browser-use/
```

It does not write to the dashboard unless `--dashboard` is explicit.

## Cloud Search

After setting `BROWSER_USE_API_KEY`:

```powershell
npm.cmd run browser-use:cloud
```

Custom task:

```powershell
npm.cmd run browser-use:cloud -- --max-jobs 20 --task "Search active junior developer internships in Lisboa and remote Portugal. Return only public active job URLs."
```

## Dashboard Write

Only after reviewing the ranked output:

```powershell
npm.cmd run browser-use:cloud -- --dashboard --write-limit 5
```

or from an HTML report:

```powershell
npm.cmd run browser-use:rank -- --from-html "..\..\lisbon-tech-junior-brief.html" --dashboard --write-limit 5
```

Dashboard writes still go through official Leagle Job scoring and duplicate
guards.

## Current Result From Lisbon Brief

Using `lisbon-tech-junior-brief.html`:

- 12 jobs found in the HTML report.
- 9 were new after Leagle Job dedupe.
- 2 were already known.
- 1 was duplicate inside the report.
- 5 were selected by official Leagle Job scoring.

Top official result:

- Match Profiler - Junior Fullstack Developer - Estagio IEFP: 86.4/100 APPLY.

This proves Browser Use is useful as a discovery layer, but its own scores must
not be trusted as final. Leagle Job scoring remains the decision layer.
