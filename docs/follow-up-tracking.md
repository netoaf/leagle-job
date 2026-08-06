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

## Dashboard Behavior

When a status changes in the dashboard:

- `Applied`: sets `applied_at`, `last_contact`, `followup_due` +7 days and a follow-up action.
- `Responded`: sets `last_contact`, `followup_due` +3 days and a reply action.
- `Interview`: sets `last_contact`, `followup_due` +1 day and an interview prep action.
- `Offer`: sets `last_contact`, `followup_due` +2 days and an offer review action.
- `Skip`, `Rejected`, `Discarded`: closes follow-up.

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

## Rule

Follow-up tracking helps you remember what to do next. It does not send emails,
messages or applications automatically.
