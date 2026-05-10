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

**Any status change** (submission, withdrawal, rejection, closing, deciding not to pursue) must update **both**:

1. `$APPLICANT_DIR/application-tracker.md` — update the row (status, next action, or move to Closed section)
2. `$APPLICANT_DIR/applications/<folder>/notes.md` — update the header **Status** field to match

**Why:** Updating only the tracker leaves notes.md out of sync. First happened with PunttAI (2026-05-02, only tracker updated on submission). Extended 2026-05-09: same issue applies to withdrawals and "not pursuing" decisions — user had to prompt for notes.md update.

**How to apply:** Treat every status change as a two-file operation. No exceptions for "quick" closes or decisions not to apply.
