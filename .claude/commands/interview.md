Load interview preparation context for a specific application.

**Usage:** `/interview [company] [stage?]`
**Examples:**
- `/interview Middesk`
- `/interview Middesk "technical screen"`

Execute the workflow `$APP_DIR/workflows/prepare-interview/` — read the pinned version per its `skill.yaml` (interactive sessions: prefer `draft.md` if present). It orchestrates: locate the application, load its context files per the storage-routing policy, and produce the prep brief via skill `interview-prep`.
