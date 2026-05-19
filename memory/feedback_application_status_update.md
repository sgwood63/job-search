---
name: application-status-update-rule
description: "Any status change — applied, not pursuing, closed — must update both tracker AND notes.md in the application folder"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f0ba43a8-e226-4f7c-ac90-cb4c37b4ea99
---

Any time the user changes the status of an application (submitted, not pursuing, closed, rejected), update **both**:

1. `$APPLICANT_DIR/application-tracker.md` — move row to the correct section with updated Status and Next Action
2. `$APPLICANT_DIR/applications/<folder>/notes.md` — update the header **Status** field to match

This applies to **all** status transitions:
- "Applied" → Status: `Applied YYYY-MM-DD`, Next Action: `Awaiting response`
- "Not pursuing / no fit" → Status: `Not pursuing — <reason> (decided YYYY-MM-DD)`
- "Closed / rejected by company" → Status: `Rejected YYYY-MM-DD` or `Closed`

If multiple folders exist for the same role (duplicate ingest runs), update **all** of them.

**Why:** Tracker-only updates were made twice (PunttAI 2026-05-02, Adobe 3D 2026-05-13) before the user had to prompt. The application folder is a self-contained record — its notes.md must stay in sync with the tracker.

**How to apply:** Treat every status change as a two-target update. Never update just the tracker.

---

**Submission recording in notes.md:** Do NOT create a `## Submission Log` section. Update the `**Status:**` header field and append a one-line entry to the existing `## Application Log` section. The Application Log is the single chronological record of all events for a folder.

Format: `- [date] — Applied via [portal name] ([URL]); resume: [filename].pdf`

**Why:** A `## Submission Log` section was incorrectly created during the Pylon application (2026-05-13) because apply.md instructed it. This created a duplicate logging structure. The Application Log already serves this purpose — adding a second section is redundant and inconsistent.
