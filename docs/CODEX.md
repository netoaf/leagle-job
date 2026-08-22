# Leagle Job — Codex Setup

Leagle Job supports Codex through the root `AGENTS.md` file and reuses the
compatible Career-Ops modes and commands.

If your Codex client reads project instructions automatically, `AGENTS.md`
is enough for routing and behavior. Codex should reuse the same checked-in
mode files, templates, tracker flow, and scripts that already power the
Claude workflow.

## Prerequisites

- A Codex client that can work with project `AGENTS.md`
- Node.js 18+
- Playwright Chromium installed for PDF generation and reliable job verification
- Go 1.21+ if you want the TUI dashboard

## Install

```bash
npm install
npx playwright install chromium
```

## Recommended Starting Prompts

- `Evaluate this job URL with Leagle Job and run the full pipeline.`
- `Scan my configured portals for new roles that match my profile.`
- `Generate the tailored ATS PDF for this role using Leagle Job.`

## Routing Map

| User intent | Files Codex should read |
|-------------|-------------------------|
| Raw JD text or job URL | `modes/_shared.md` + `modes/auto-pipeline.md` |
| Single evaluation only | `modes/_shared.md` + `modes/oferta.md` |
| Multiple offers | `modes/_shared.md` + `modes/ofertas.md` |
| Portal scan | `modes/_shared.md` + `modes/scan.md` |
| PDF generation | `modes/_shared.md` + `modes/pdf.md` |
| Live application help | `modes/_shared.md` + `modes/apply.md` |
| Pipeline inbox processing | `modes/_shared.md` + `modes/pipeline.md` |
| Tracker status | `modes/tracker.md` |
| Deep company research | `modes/deep.md` |
| Training / certification review | `modes/training.md` |
| Project evaluation | `modes/project.md` |
| Email draft second-pass | `docs/email-drafts.md` + exact live JD + `data/candidate-evidence.md` |
| Gmail draft/sent/reply sync | `docs/gmail-adapter.md` + `config/email.yml` + adapter JSON request |

The key point: Codex support is additive. It should route into the existing
Leagle Job modes and compatible Career-Ops scripts rather than introducing a parallel automation
layer.

## Behavioral Rules

- Treat raw JD text or a job URL as the full auto-pipeline path unless the user explicitly asks for evaluation only.
- Keep all personalization in `config/profile.yml`, `modes/_profile.md`, `article-digest.md`, or `portals.yml`.
- Never verify a job’s live status with generic web fetch when Playwright is available.
- Never submit an application for the user.
- Never add new tracker rows directly to `data/applications.md`; use the TSV addition flow and `merge-tracker.mjs`.
- A Codex email review must run after deterministic draft quality and a fresh
  Playwright vacancy check, and before any Gmail draft is created.
- Codex may recommend changes and return revised subject/body copy. The review
  must produce an auditable local decision (`ready_for_gmail_draft`, `revise`
  or `block`) and must fail closed on unsupported claims, stale vacancy
  evidence, an uncertain recipient, attachment or CV/language choice.
- A Gmail adapter may create the reviewed draft automatically when all gates
  pass. Human approval is required only before sending the email or submitting
  the application; Codex and the adapter must never auto-send or auto-submit.
- For Gmail work, Codex must execute only the exact action in the adapter JSON.
  `gmail.create_draft` is allowed; `send_draft` is prohibited even if a draft
  appears ready.
- Sent/reply synchronization is read-only in Gmail. Import message IDs and
  classifications through `gmail-sync.mjs`; do not mark an application as sent
  or responded from a subject match alone when the thread/participants do not
  match.

## Verification

```bash
npm run verify

# optional dashboard build
cd dashboard && go build ./...
```
