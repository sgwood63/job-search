Fetch LinkedIn jobs and save fit jobs as application stubs for review.

**Usage:** `/linkedin-ingest [profile] [--max-pages N] [--page-delay N] [--jd-delay N]`

**Modes:**
- `/linkedin-ingest` — recommended feed (unchanged): scrapes https://www.linkedin.com/jobs/collections/recommended
- `/linkedin-ingest presales-se` — profile-search: reads Search Queries rows for the profile from
  PROFILES-QUICK-REFERENCE.md, runs one LinkedIn search URL per row, deduplicates across sub-queries

**Options:**
- `--max-pages N` — pages per sub-query (default 4; 0 = unlimited)
- `--page-delay N` — seconds between pages in the scraper (default 20)
- `--jd-delay N` — seconds between JD fetch calls in the workflow (default 10)

**Examples:**
- `/linkedin-ingest` — recommended feed, up to 4 pages
- `/linkedin-ingest --max-pages 10` — recommended feed, 10 pages
- `/linkedin-ingest presales-se` — profile search, all sub-queries, 4 pages each
- `/linkedin-ingest ai-governance-se --max-pages 6 --page-delay 30`

Execute workflow `$APP_DIR/workflows/search-jobs-linkedin/` (pinned version; prefer draft.md if present).
Per-job processing delegates to `workflows/process-jd/`.
