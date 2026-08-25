# Gmail Adapter

Leagle Job uses the Codex Gmail connector as its authenticated transport. The
local Node.js layer remains the source of truth for validation, idempotency,
hashes, tracker updates and follow-up state. No Gmail credentials or tokens are
stored in the repository.

## Dashboard shortcut

The main dashboard shortcut `D` runs:

```powershell
npm.cmd run gmail-draft-live -- --id <application-id>
```

It repeats the live Playwright vacancy check, prepares the deterministic local
draft and CV attachment, invokes an authenticated non-interactive Codex CLI
session with the Gmail plugin, records the returned Gmail draft ID and stops.
It never calls a Gmail send action. If the authenticated Codex execution fails,
the Gmail plugin is unavailable, or any vacancy/recipient/evidence/attachment gate fails,
the dashboard reports `BLOQUEADO` and does not pretend a local file is a Gmail
draft.

One-time prerequisite:

```powershell
./tools/codex/codex.exe login
./tools/codex/codex.exe
# Then open /plugins and install/connect Gmail.
```

## Non-Negotiable Boundary

- The adapter may create Gmail drafts.
- The adapter may search and read sent messages and replies.
- The adapter may recommend next actions.
- The adapter may create a due follow-up as an unsent threaded draft.
- The adapter must never call `send_draft`, send a message, submit an
  application or infer a recipient.
- Human approval is required only at the final Send/Submit action.

## Initial Application Draft

```text
fresh Playwright vacancy proof (<15 minutes)
  -> deterministic CV/language/recipient selection
  -> application-pack quality gate
  -> SHA-256 of copy and attachment
  -> Codex evidence review and recommendations
  -> connector creates unsent Gmail draft
  -> adapter records Gmail IDs
  -> human reviews and sends manually
```

Prepare review requests:

```powershell
npm.cmd run gmail-adapter
```

List requests that have a current passing Codex review:

```powershell
npm.cmd run gmail-adapter:ready
```

The connector result is imported with:

```powershell
node gmail-adapter.mjs record-draft --file output/gmail-adapter/results/result.json
```

Every result must repeat the request `email_draft_id` and `source_hash`. A
changed draft, attachment or vacancy timestamp invalidates the review and
blocks the import.

## Gmail Synchronization

Build read-only Gmail searches:

```powershell
npm.cmd run gmail-sync
```

The Codex Gmail connector executes those searches, reads only the matching
messages and imports normalized events:

```powershell
node gmail-sync.mjs import --file output/gmail-adapter/results/sync-events.json
```

Supported events:

An email scheduled in Gmail but not yet carrying the `SENT` label is recorded
in the tracker as `Scheduled`. It must not create a `sent` event, count as
`Applied`, or start a follow-up window. Once Gmail confirms delivery in
`SENT`, the normal `sent` import advances either `Evaluated` or `Scheduled` to
`Applied`.

- `sent`: advances an `Evaluated` or `Scheduled` application to `Applied`, starts a no-response
  follow-up window and records the Gmail thread.
- `reply`: advances `Applied`/`Evaluated` to `Responded`, classifies the response
  and recommends the next step.
- `automated_reply`: records an acknowledgement without pretending it is a
  human response.

Events are idempotent by Gmail message ID and stored in
`data/gmail-events.tsv`.

## Automatic Follow-Up Drafts

List due no-response follow-ups:

```powershell
npm.cmd run gmail-followups
```

When a record is due, still `Applied`, has no human reply and has no existing
follow-up draft, Codex reviews the short follow-up and the connector may create
an unsent reply draft in the original Gmail thread. The result is recorded
with:

```powershell
node gmail-sync.mjs record-followup-draft --file output/gmail-adapter/results/followup-result.json
```

The system never creates a second follow-up draft for the same due record. If a
reply arrives while a follow-up draft exists, the recommendation explicitly
warns the user not to send the pending follow-up.

## Response Advice

- Interview invitation: review availability, reply manually within 24 hours,
  prepare interview notes.
- Request for information: provide only confirmed facts and reply manually
  within 24 hours.
- Rejection: confirm it is explicit, then mark `Rejected`; no automatic reply.
- Other human reply: review and answer manually within two working days.
- Automated acknowledgement: keep waiting; it does not count as a human reply.

## Audit Files

```text
output/gmail-adapter/draft-requests/
output/gmail-adapter/reviews/
output/gmail-adapter/results/
data/email-drafts.tsv
data/gmail-events.tsv
data/application-followups.tsv
```

`output/` is local and may be regenerated. The TSV files are durable user data.
