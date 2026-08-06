# Leagle Job Application Actions

Application actions track the operational step between a strong evaluated job
and a real manual application.

They answer:

- which channel should be used;
- whether an apply URL exists;
- whether a recruiter email is still missing;
- what is blocking the application;
- what the next human action is.

They do not send emails, create Gmail drafts, upload CVs or submit forms.

## Commands

Preview the top 10 actionable jobs:

```powershell
npm.cmd run application-actions:dry-run -- --top 10
```

Write action rows for the top 5:

```powershell
npm.cmd run application-actions -- --top 5
```

Write rows for specific tracker IDs:

```powershell
npm.cmd run application-actions -- --id 57,58,2
```

## Store

Rows are written to:

```text
data/application-actions.tsv
```

This file is local user state and should not be committed.

## Statuses

- `ready_manual_review`: channel exists, but pack/CV/draft still need human
  review before submitting.
- `needs_channel`: official application channel is missing or unclear.
- `needs_recipient`: email channel is selected but recipient is missing.
- `blocked_missing_report`: tracker points to a missing report.

## Required Human Review

Before any application:

1. Read the report.
2. Review the application pack.
3. Run `npm.cmd run draft-quality`.
4. Confirm remaining red flags.
5. Review any CV tailoring diff.
6. Submit manually only after explicit approval.
