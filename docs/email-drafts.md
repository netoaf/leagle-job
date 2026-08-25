# Leagle Job Email Drafts

Email drafts are a local preparation layer and the audited input for the Codex
Gmail draft adapter.

They do not:

- send Gmail drafts;
- send emails;
- upload CVs;
- submit applications.

They do:

- extract the email draft from each report;
- write a local review file in `output/email-drafts-local/`;
- track draft status in `data/email-drafts.tsv`;
- feed the Gmail adapter only after every validation gate passes;
- select PT/EN and Backend/Full-stack/Automation-QA for each vacancy using the
  same rules as the application pack;
- use the matching CV-library source if the copied pack CV is not present.

## Commands

Check the email safety policy:

```powershell
npm.cmd run email:check
```

Preview local drafts:

```powershell
npm.cmd run email-drafts:dry-run -- --top 3
```

Write local drafts:

```powershell
npm.cmd run email-drafts -- --top 3
```

Generate for specific tracker IDs:

```powershell
npm.cmd run email-drafts -- --id 57,58
```

If a recipient is already confirmed:

```powershell
npm.cmd run email-drafts -- --id 57 --to "recruiting@example.com"
```

## Files

Config:

```text
config/email.yml
```

Example config:

```text
config/email.example.yml
```

Tracking:

```text
data/email-drafts.tsv
```

Local draft files:

```text
output/email-drafts-local/
```

## Statuses

- `needs_recipient`: draft text exists, but recruiter/company email is not confirmed.
- `local_ready`: recipient is confirmed and local draft is ready for review.
- `blocked_missing_draft`: report has no usable draft.
- `blocked_missing_report`: tracker points to a missing report.
- `blocked_missing_cv`: the vacancy-specific CV is missing from the pack and
  the CV library.
- `blocked_unverified_vacancy`: the official vacancy has not been re-opened and
  marked recently in the tracker.
- `gmail_draft_created`: the unsent Gmail draft was created and its ID recorded.
- `sent_manually`: reserved for manual confirmation after sending.

## Safety Contract

- `auto_send` must stay `false`.
- `human_review_required` must stay `true`; it applies to sending/submitting,
  not to automatic creation of a Gmail draft.
- `allow_real_gmail_drafts` may be `true` only with the Codex Gmail connector.
- `allow_cv_attachment_in_gmail` may be `true` only with deterministic CV
  selection, file-existence validation and a recorded SHA-256 hash.
- Run `npm.cmd run draft-quality` before using generated application material.
- A local draft is not proof that an application was sent.
- Confirm `Planned attachment` and `CV preselection` in every local draft.
- Before a draft can become `local_ready`, open the official vacancy and add
  `[live-verified:ISO_TIMESTAMP] [live-method:playwright] [live-state:active]`
  to its tracker notes. The proof expires after 15 minutes. Search results,
  cached text, a generic careers page, login wall, ambiguous redirect, missing
  description, missing application channel, 404 or an inactive notice do not
  authorize a draft.

## Codex Second-Pass And Automatic Gmail Draft Gate

Codex can be added as a second reviewer before a draft is created in Gmail. It
may recommend changes and return a revised subject and body, but it must remain
a fail-closed reviewer grounded in the exact live vacancy and candidate
evidence rather than a free-form writer.

Required sequence:

```text
fresh Playwright verification
  -> deterministic CV/language/attachment selection
  -> local draft + draft-quality gate
  -> Codex review against exact live JD and candidate evidence
  -> structured review artifact, recommendations and revised copy when needed
  -> automatic Gmail draft creation when every gate passes
  -> human review in Gmail
  -> manual send
```

The Codex pass may improve relevance, clarity and tone. It must not add a skill,
metric, project feature, employer claim or vacancy fact that is absent from the
trusted candidate evidence or the freshly verified job description.

Recommended review output:

- `decision`: `ready_for_gmail_draft`, `revise` or `block`;
- `recommendations`: concise proposed changes and their evidence;
- `unsupported_claims`: exact phrases that are not supported;
- `missing_relevant_evidence`: confirmed evidence that should be considered;
- `cv_choice_check`: PT/EN and Backend/Full-stack/Automation-QA decision;
- `vacancy_facts_check`: company, role, eligibility, location and channel;
- `revised_subject` and `revised_body` only when `decision=revise`;
- `gmail_draft_allowed`: `true` only when the reviewed or revised copy passes
  every deterministic and evidence gate;
- `source_hash`, `reviewed_at`, `model`, `prompt_version` and diff path for audit.

Do not let the reviewer edit Gmail directly. It should write a reviewed local
artifact first. The Gmail adapter may then consume the reviewed copy
automatically, without a separate human approval step, only when:

- the official vacancy was verified live with Playwright less than 15 minutes ago;
- the recipient is explicit and supported by the official vacancy or company source;
- language, CV variant and attachment path were selected deterministically;
- every attachment exists and matches the recorded file hash;
- the local quality gate and Codex evidence review pass;
- the final copy contains no unsupported claim.

Human approval is required only for sending the email or submitting the
application. The adapter must never auto-send, auto-submit, infer a recipient,
or silently replace an attachment.

## Recommended Flow

```text
report
  -> application-pack
  -> vacancy-specific CV selection
  -> draft-quality
  -> email-drafts local file
  -> Codex second-pass review and recommendations
  -> automatic Gmail draft creation when every gate passes
  -> human review in Gmail
  -> manual send
  -> dashboard status/follow-up
```
