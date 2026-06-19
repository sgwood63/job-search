Fetch LinkedIn job recommendations and save fit jobs as application stubs for review.

**Usage:** `/linkedin-ingest [--max-pages N]`
**Examples:**
- `/linkedin-ingest` — fetch up to 4 pages (default)
- `/linkedin-ingest --max-pages 10`
- `/linkedin-ingest --max-pages 0` — unlimited

Execute the workflow `$APP_DIR/workflows/search-jobs-linkedin/` — read the pinned version per its `skill.yaml` (interactive sessions: prefer `draft.md` if present). Per-job processing delegates to `workflows/process-jd/`.
