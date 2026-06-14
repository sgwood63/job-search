---
name: search-jobs-linkedin
description: Fetch LinkedIn job recommendations; screen and save fit jobs as stubs
---

# search-jobs-linkedin Workflow (DRAFT — v2)

Fetches LinkedIn job recommendations via Playwright, deduplicates inline per job via `check_position_seen` (OB1) or `ingested-positions.csv` (local), and delegates per-job processing to `process-jd`. Fit jobs are saved as application stubs — **no auto-generated resumes**. Triggered by `/linkedin-ingest`.

**Changes from v1:**
- Dedup moved from `linkedin-seen-jobs.json` (separate Step 4) to inline per-job `check_position_seen` MCP tool (OB1) or CSV (local). No `linkedin-seen-jobs.json` file is read or written.
- Every position encountered is logged to `js_ingested_positions` (OB1) or appended to `ingested-positions.csv` (local).
- Summary `.md` is still generated and uploaded to OB1 (`summary_key` stored in `js_search_runs`). This enables human review and backfill.
- Repost detection: positions seen >60 days ago are flagged and included in run summary.

## Step 1 — Load Context

- Read `$APP_DIR/.env`; resolve `$APP_DIR`, `$APPLICANT_DIR`, `PLAYWRIGHT_PYTHON`, `DATA_BACKEND`
- If `PLAYWRIGHT_PYTHON` is not set: tell the user to add it and stop
- Parse invocation arguments: `--max-pages N` (default 4; 0 = unlimited)
- Load `applicant.md`:
  - OB1: `get_file('applicant.md')`
  - Local: read `$APPLICANT_DIR/applicant.md`
- Load `PROFILES-QUICK-REFERENCE.md`:
  - OB1: `get_file('profiles/PROFILES-QUICK-REFERENCE.md')`
  - Local: read `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
- Extract all active profile slugs from PROFILES-QUICK-REFERENCE.md

Pre-extract and cache for reuse across all jobs:
- From `applicant.md`: "Location" section, "Deal-breakers (Hard No)" section, "Not interested in" from Role Preferences, compensation/target salary line
- From `PROFILES-QUICK-REFERENCE.md`: `## Hard Stops` section, `## Location Check` section, profile overview table

**Local mode only — load dedup table:**
Read `$APPLICANT_DIR/search/ingested-positions.csv` into memory as a lookup set. If file does not exist, start with an empty set.

## Step 2 — Initialize Counters

```
fit_count = 0
no_fit_count = 0
fetch_failed_count = 0
duplicate_count = 0
repost_count = 0
closed_count = 0
pages_fetched = 0
total_results = 0
screened = 0
repost_jobs = []     # {company, title, first_seen_at}
fetch_failed_jobs = []   # {company, title, location, reason}
run_timestamp = <capture now as YYYYMMDD-HHMMSS>
tmp_recs_file = /tmp/linkedin-recs-<run_timestamp>.json
search_run_id = null  # set after log_search_run (OB1 only)
```

## Step 3 — Fetch LinkedIn Recommendations

Run the scraper:
```bash
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-linkedin-recs.py" [--max-pages N] --out "$tmp_recs_file"
```

- **Exit code 2** (auth expired): stop and tell the user:
  ```
  python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'
  ```
- **Exit code 1** (error): report and stop
- **Exit code 0**: parse `$tmp_recs_file` as JSON; set `pages_fetched`, `total_results`, `raw_jobs`

If `raw_jobs` is empty: output "No jobs returned from LinkedIn recommendations." and stop.

## Step 4 — Fetch Full JD and Process Each Job (with inline dedup)

**For each job in `raw_jobs`:**

**4a. Build apply link:**
- `apply_link = job.apply_link` (canonical LinkedIn job view URL)
- If absent but `job.job_id` present: derive `apply_link = "https://www.linkedin.com/jobs/view/<job_id>"`
- If neither: `apply_link = null`

**4b. Dedup check:**

- **OB1:** Call `check_position_seen(source_url=<apply_link or null>, company_name=<job.company>, role_title=<job.title>)`
  - `seen=true AND is_repost=false`: call `log_ingested_position(source_url=<apply_link>, company_name=<job.company>, role_title=<job.title>, outcome='duplicate', search_run_id=<search_run_id>)`, increment `duplicate_count`, output `= <Company> — <Title> [already seen]`, continue to next job
  - `seen=true AND is_repost=true`: call `log_ingested_position(..., outcome='duplicate', is_repost=true, first_seen_at=<result.first_seen_at>, search_run_id=<search_run_id>)`, increment `duplicate_count` and `repost_count`, append to `repost_jobs`, output `~ <Company> — <Title> [repost — first seen <first_seen_at>]`, continue to next job
  - `seen=false`: continue below

- **Local:** Check in-memory dedup set for: (1) `apply_link` URL match, (2) `lower(company):lower(title)` exact match
  - Match found: append row to CSV with `outcome=duplicate`, increment `duplicate_count`, output `= <Company> — <Title> [already seen]`, continue to next job
  - No match: continue below

**4c. Attempt to fetch the full JD** (if `apply_link` is set):

If `apply_link` is null: `fetch_result = "no_url"`, `full_jd_content = null` → jump to **4d (Failure)**

- **Try WebFetch first.** If response contains login-wall signals or URL contains auth path segments: skip WebFetch, fall through.
- **If WebFetch succeeded:** `fetch_result = "success"`, `full_jd_content = <response body>` — proceed to 4e.
- **Fall back to fetch-jd.py:**
  ```bash
  "$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out - "<apply_link>"
  ```
  - Exit 0: `fetch_result = "success"`, `full_jd_content = stdout` — proceed to 4e
  - Exit 2: `fetch_result = "auth_required"` → jump to 4d; also tell the user to re-authenticate
  - Exit 3: job closed — do NOT create a folder; output: `- <Company> — <Title> [skipped — job closed]`; increment `closed_count`; continue to next job
  - Exit 1 or other: `fetch_result = "failed"` → jump to 4d

**4d. Failure handling** (when `full_jd_content == null`):

Derive folder slug from `job.company` and `job.title` (lowercase, spaces → hyphens). If both empty: `YYYY-MM-DD-linkedin-<job_id>`.

Compose and save minimal fetch-failed stub (same structure as v1: `notes.md` + `jd-<company>-<role>.md` + `search-result.json`).

**OB1:**
- `upload_file(...)` for the three files
- `upsert_company(...)`, `create_application(..., status='pending-review', status_detail='Fetch failed — <fetch_result>')`
- `log_ingested_position(source_url=<apply_link>, company_name=<job.company>, role_title=<job.title>, profile_slug=null, search_run_id=<search_run_id>, application_id=<new_app_id>, outcome='fetch-failed', no_fit_reason=<fetch_result>)`

**Local:**
- Write folder + files, append to `application-tracker.md`
- Append to `ingested-positions.csv`; add to in-memory dedup set

Increment `fetch_failed_count`, append to `fetch_failed_jobs`. Output: `! <Company> — <Title> [fetch failed — <fetch_result>]`. Continue to next job.

**4e. Process the JD** (when `full_jd_content != null`):

Increment `screened`.

Call workflow `process-jd` with:
- `jd_content = full_jd_content`
- `source_url = apply_link`
- `source_name = "LinkedIn Recommendations"`
- `profile_hint = null` (jd-evaluation picks best profile from all active profiles)
- `source_metadata = {job_id: job.job_id, posted_at: job.posted_at, raw_source_json: json.dumps(job.raw, indent=2)}`

`process-jd` returns `{folder_slug, application_id, verdict, score, profile_match}`.

**After process-jd resolves:**
- **OB1:** `log_ingested_position(source_url=<apply_link>, company_name=<job.company>, role_title=<job.title>, profile_slug=<profile_match>, search_run_id=<search_run_id>, application_id=<application_id if fit else null>, outcome=<verdict>, no_fit_reason=<score+reason if no-fit>)`
- **Local:** Append row to `ingested-positions.csv`; add to in-memory dedup set

Output one line: `+ <Company> — <Title> → applications/<folder_slug>/` (fit) or `- <Company> — <Title> [no fit — score N/10]` (no-fit). Increment `fit_count` or `no_fit_count`.

After all jobs processed:
```bash
rm -f "$tmp_recs_file"
```

## Step 5 — Write Summary and Log Run Stats

`summary_filename` = `YYYY-MM-DD-HHMMSS-linkedin-recommended-summary.md` (from run start time).

**5a — Generate summary `.md`** (always, both OB1 and local):

```markdown
# Search Summary — linkedin-recommended — YYYY-MM-DD HH:MM:SS

**Profile:** linkedin-recommended
**Date:** YYYY-MM-DD HH:MM:SS
**Pages fetched:** <pages_fetched>
**Total results:** <total_results>
**New (deduped):** <screened+fetch_failed_count>
**Screened:** <screened>
**Fit:** <fit_count>
**No fit:** <no_fit_count>
**Fetch failed:** <fetch_failed_count>
**Closed (job no longer available):** <closed_count>

## Sub-queries

1. https://www.linkedin.com/jobs/collections/recommended

## Fit Jobs (score >= 7)

| Company | Role | Location | Score | Folder |
|---------|------|----------|-------|--------|
<one row per fit job; "_No fit jobs found._" if fit_count == 0>

## No-Fit Jobs

| Company | Role | Location | Score | Reason |
|---------|------|----------|-------|--------|
<one row per no-fit job>

## Failed to Fetch

| Company | Role | Location | Reason |
|---------|------|----------|--------|
<one row per job in fetch_failed_jobs; "_No fetch failures._" if none>
```

- **OB1:** `upload_file('search/<summary_filename>', <content>, 'text/markdown')` → capture `storage_key`
- **Local:** write to `$APPLICANT_DIR/search/<summary_filename>`; `storage_key = null`

**5b — Log run stats:**

**OB1:** `log_search_run(profile_slug="linkedin-recommended", query="https://www.linkedin.com/jobs/collections/recommended", pages_fetched=<pages_fetched>, total_results=<total_results>, new_after_dedup=<screened+fetch_failed_count>, screened=<screened>, fit_count=<fit_count>, summary_key=<storage_key>)` → capture returned `search_run_id`

**Local:** Append to `$APPLICANT_DIR/search/search-log.csv` (create with header if missing):
```
date,time,profile,pages_fetched,total_results,screened,fit_count,fetch_failed,duplicate_count,query
```

## Step 6 — Report

```
LinkedIn ingestion complete
  Pages fetched:     <pages_fetched>
  Jobs returned:     <total_results>
  Screened:          <screened>
  Fit:               <fit_count>
  No fit:            <no_fit_count>
  Duplicates:        <duplicate_count>
  Fetch failed:      <fetch_failed_count>
  Closed (skipped):  <closed_count>
```

If `repost_count > 0`: append "Reposts detected" list (company/role/first_seen_at) — user may want to re-evaluate.

## Rules

- Do not auto-generate resumes. Fit jobs are saved as stubs for the applicant to review.
- Try WebFetch before fetch-jd.py on each apply_link — LinkedIn pages usually require auth; fall through immediately if WebFetch returns a login wall.
- `search-result.json` is written for every job that gets a folder.
- Call `log_ingested_position` for EVERY job processed (including duplicates and fetch-failed). This is the canonical audit trail.
- Do not fabricate company, role, or location data.
- Use `$PLAYWRIGHT_PYTHON` (not system python3) for all scripts.
- Auth refresh: if exit code 2, stop and tell the user to run `python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'`
