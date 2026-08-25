# Setup Guide

`COMECE-AQUI.md` is the canonical beginner guide. On Windows, extract the ZIP
and run `setup.bat`; it installs the locked Node dependencies, optional
Playwright browser support, neutral local templates and the first diagnostic.

Codex, Claude Code and other agents are optional. The local pipeline, terminal
dashboard, scoring, tracker and reviewed application packs work without them.

## Manual setup

Use this only when `setup.bat` is unavailable:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
Copy-Item config/profile.example.yml config/profile.yml
Copy-Item config/scoring.example.yml config/scoring.yml
Copy-Item config/jobfinder-rules.example.yml config/jobfinder-rules.yml
Copy-Item modes/_profile.template.md modes/_profile.md
Copy-Item templates/portals.example.yml portals.yml
Copy-Item templates/cv.example.md cv.md
npm.cmd run doctor
```

Edit the local `cv.md`, `config/profile.yml`, `modes/_profile.md` and
`portals.yml` before any real search. They are ignored by Git and never belong
in a release package.

## First local workflow

```powershell
npm.cmd run jobfinder:health
npm.cmd run portals:audit
npm.cmd run coverage:audit
npm.cmd run leagle:new:dry-run -- --limit 80
```

Review results before using any write-mode command. See
[`operational-runbook.md`](operational-runbook.md) for the full daily,
recovery and application-review workflow.

## Dashboard and release build

The Windows ZIP includes `dashboard\career-dashboard-live.exe`; use Go 1.24.2+
only to rebuild the dashboard or produce a release package. For a safe local
package, run `criar-pacote.bat`; never zip a live worktree manually.
