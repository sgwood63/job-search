---
name: Application Status Update Rule
description: When marking an application as submitted, update both tracker and notes.md — not just the tracker
type: feedback
---

When the user says they applied to a position, update **both**:

1. `$APPLICANT_DIR/application-tracker.md` — change Status to `Applied YYYY-MM-DD` and Next Action to `Awaiting response`
2. `$APPLICANT_DIR/applications/<folder>/notes.md` — update the header Status field and the Process Reminder section to reflect submitted state (remove "apply" action, set applied date and awaiting response)

**Why:** First time this came up (PunttAI, 2026-05-02), only the tracker was updated. The user had to prompt for notes.md.

**How to apply:** Any time the user confirms they submitted an application — treat it as a two-file update, not one.
