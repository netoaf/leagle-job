# Mode: prepare a manual application

Read `modes/_shared.md`, the application report and the selected CV evidence
before using this mode. The user, not the agent, performs the final submit/send
action.

## Preconditions

- Official vacancy is live and the tracker has fresh Playwright verification
  markers.
- Application channel is confirmed.
- Required candidate facts, eligibility, recipient and CV are confirmed or
  explicitly blocked.
- Application pack and draft-quality gate have passed where applicable.

## Allowed assistance

- Explain the official application channel and required fields.
- Select the documented CV variant and prepare evidence-backed answers.
- Open the official portal and fill only confirmed non-sensitive fields when
  the user explicitly asks for portal preparation.
- Create one unsent Gmail draft only through the documented, explicitly enabled
  adapter and only after every gate passes.

## Stop and ask the user

- Before file upload, CAPTCHA, consent questions, sensitive identifiers,
  salary expectations without a confirmed answer, final send or final submit.
- When requirements, eligibility, a recipient, the vacancy state or a candidate
  claim are uncertain.

## After a visible human submission

Record only confirmed submission evidence through the supported status/action
flow, then run `npm run verify`. Never mark a draft, scheduled message or
prepared form as `Applied`.
