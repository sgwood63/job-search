Search Google Jobs for a profile and save fit jobs as application stubs for review.

**Usage:** `/ingest [profile] [--fits N] [--batch N]`
**Examples:**
- `/ingest` — list available profiles and prompt for selection
- `/ingest presales-se`
- `/ingest presales-se --fits 15`
- `/ingest presales-se --batch 5`

Execute the workflow `$APP_DIR/workflows/search-jobs/` — read the pinned version per its `skill.yaml` (interactive sessions: prefer `draft.md` if present). Per-job processing delegates to `workflows/process-jd/`.
