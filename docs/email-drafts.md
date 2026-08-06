# Leagle Job Email Drafts

Email drafts are a local preparation layer before any Gmail integration.

They do not:

- create Gmail drafts;
- send emails;
- upload CVs;
- submit applications.

They do:

- extract the email draft from each report;
- write a local review file in `output/email-drafts-local/`;
- track draft status in `data/email-drafts.tsv`;
- keep the system ready for a future Gmail draft adapter;
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
- `gmail_draft_created`: reserved for future Gmail adapter.
- `sent_manually`: reserved for manual confirmation after sending.

## Safety Contract

- `auto_send` must stay `false`.
- `human_review_required` must stay `true`.
- `allow_real_gmail_drafts` stays `false` until a Gmail adapter is implemented.
- `allow_cv_attachment_in_gmail` stays `false` until explicit attachment approval exists.
- Run `npm.cmd run draft-quality` before using generated application material.
- A local draft is not proof that an application was sent.
- Confirm `Planned attachment` and `CV preselection` in every local draft.
- Before a draft can become `local_ready`, open the official vacancy and add
  `[verified:YYYY-MM-DD]` to its tracker notes. The default validity window is
  seven days.

## Recommended Flow

```text
report
  -> application-pack
  -> vacancy-specific CV selection
  -> draft-quality
  -> email-drafts local file
  -> human review
  -> future Gmail draft creation
  -> manual send
  -> dashboard status/follow-up
```
