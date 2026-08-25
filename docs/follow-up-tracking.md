# Follow-Up Tracking

Leagle Job tracks follow-up separately from the main dashboard table.

Main tracker:

```text
data/applications.md
```

Follow-up tracker:

```text
data/application-followups.tsv
```

## Why Separate Files

`data/applications.md` stays readable and stable. Follow-up data changes more
often, so it lives in a TSV file keyed by application/report number.

## Fields

- `id`
- `report_number`
- `company`
- `role`
- `applied_at`
- `last_contact`
- `followup_due`
- `contact_channel`
- `contact_name`
- `next_action`
- `notes`
- `updated_at`
- `gmail_thread_id`
- `last_message_id`
- `followup_draft_id`
- `response_state`
- `recommendation`
- `synced_at`

## Dashboard Behavior

When a status changes in the dashboard:

- `Applied`: sets `applied_at`, `last_contact`, `followup_due` +7 days and a follow-up action.
- `Responded`: sets `last_contact`, `followup_due` +3 days and a reply action.
- `Interview`: sets `last_contact`, `followup_due` +1 day and an interview prep action.
- `Offer`: sets `last_contact`, `followup_due` +2 days and an offer review action.
- `Skip`, `Rejected`, `Discarded`: closes follow-up.

When Gmail synchronization detects activity:

- a sent application becomes `Applied` and receives a due date automatically;
- a human reply becomes `Responded` and receives a classified next-step
  recommendation;
- an automated acknowledgement is recorded without being treated as a human
  response;
- a due no-response follow-up may create one unsent threaded Gmail draft after
  Codex review.

The dashboard preview shows follow-up date and next action for the selected job.

## Commands

List follow-ups:

```powershell
npm.cmd run followups
```

Initialize missing active rows:

```powershell
npm.cmd run followups:init
```

Build read-only sent/reply searches:

```powershell
npm.cmd run gmail-sync
```

List due automatic follow-up draft requests:

```powershell
npm.cmd run gmail-followups
```

## Rule

Follow-up tracking may create an unsent Gmail draft automatically. It never
sends emails, messages or applications. Sending always requires the user.
