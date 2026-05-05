---
name: Application tracking rules
description: Rules for using application-tracker.md — always check tracker before acting on a company mention; update both tracker and notes.md when an application is submitted
type: feedback
---

## Company Lookup — Check Tracker First

When the user references a company that is not already part of the current conversation context, always check `application-tracker.md` first to see if there is a prior application.

**Why:** Avoids incorrect assumptions about which role/application is relevant — the same company may appear with multiple positions or across different time periods.

**How to apply:**
1. Read `application-tracker.md` to find all entries for that company
2. If there is exactly one entry, proceed with that context
3. If there are multiple entries (different roles or dates), confirm with the user which position is relevant — include "new position" as an option
4. If there is no entry, treat it as a new company/JD to screen

## Application Status Update — Two-File Rule

When the user confirms they submitted an application, update **both**:

1. `$APPLICANT_DIR/application-tracker.md` — change Status to `Applied YYYY-MM-DD`, Next Action to `Awaiting response`
2. `$APPLICANT_DIR/applications/<folder>/notes.md` — update the header Status field and the Process Reminder section (remove "apply" action, set applied date and awaiting response)

**Why:** Updating only the tracker leaves notes.md out of sync. First time this came up (PunttAI, 2026-05-02), only the tracker was updated and the user had to prompt for notes.md.

**How to apply:** Any confirmation of submission — treat as a two-file update, not one.
