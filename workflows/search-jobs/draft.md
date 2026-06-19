---
name: search-jobs
description: Search Google Jobs via SearchAPI for a profile; screen and save fit jobs as stubs
---

# search-jobs Workflow (DRAFT — v2)

Searches Google Jobs via SearchAPI, deduplicates results via `check_position_seen` (OB1) or `ingested-positions.csv` (local), fetches full JDs, and delegates per-job processing to `process-jd`. Fit jobs are saved as application stubs — **no auto-generated resumes**. Triggered by `/ingest <profile>`.

All file access follows the storage-routing policy (`DATA_BACKEND` env var).

**Changes from v1:**
- Dedup moved from `seen-jobs.json` (Python script) to `check_position_seen` MCP tool (OB1) or `ingested-positions.csv` (local). Script called with `--no-dedup`.
- Every position encountered is logged to `js_ingested_positions` (OB1) or appended to `ingested-positions.csv` (local).
- Summary `.md` is still generated and uploaded to OB1 (`summary_key` is stored in `js_search_runs`). This enables human review and backfill.
- Repost detection: positions seen >60 days ago are flagged and included in run summary.

## Step 1 — Load Context

- Read `$APP_DIR/.env`; resolve `$APP_DIR`, `$APPLICANT_DIR`, `SEARCHAPI_KEY`, `SEARCH_TARGET_FITS` (default 10), `SEARCH_BATCH_SIZE` (default 10), `PLAYWRIGHT_PYTHON`, `DATA_BACKEND`
- If `SEARCHAPI_KEY` is not set: tell the user to add it and stop
- Parse invocation arguments: `--fits N` overrides `SEARCH_TARGET_FITS`; `--batch N` overrides `SEARCH_BATCH_SIZE`
- Load `applicant.md` for location/comp hard-stops:
  - OB1: `get_file('applicant.md')`
  - Local: read `$APPLICANT_DIR/applicant.md`
- Load `PROFILES-QUICK-REFERENCE.md`:
  - OB1: `get_file('profiles/PROFILES-QUICK-REFERENCE.md')`
  - Local: read `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
- Confirm the profile exists and has at least one row in the `## Search Queries` table
- Extract ALL rows for this profile from `## Search Queries` into ordered list `sub_queries` (2–3 rows per profile)
- If no profile argument: derive profile slugs from PROFILES-QUICK-REFERENCE.md and ask the user to choose one

Pre-extract and cache for reuse across all jobs:
- From `applicant.md`: "Location" section, "Deal-breakers (Hard No)" section, compensation/target salary line
- From `PROFILES-QUICK-REFERENCE.md`: `## Hard Stops` section, `## Location Check` section

**Local mode only — load dedup table:**
Read `$APPLICANT_DIR/search/ingested-positions.csv` into memory as an in-memory lookup set. If the file does not exist, start with an empty set.

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
repost_jobs = []  # {company, title, first_seen_at} for run summary
fetch_failed_jobs = []   # {company, title, location, reason}
run_timestamp = <capture now as YYYYMMDD-HHMMSS>
batch_file = "$APPLICANT_DIR/search/tmp-<profile>-<run_timestamp>.json"
search_run_id = null  # will be set after log_search_run (OB1 only)
```

## Step 3 — Two-Phase Execution

### Phase 3-FETCH — Fetch All Pages for All Sub-queries

Iterate over each entry in `sub_queries`. For each `current_query`:

**3a.** Set `page_token = null` for this sub-query.

**3b. Pagination loop** (repeat until no more pages for this sub-query):

3b-i. Run the search script with `--no-dedup` to skip the script's own seen-jobs.json check:
```bash
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/search-jobs.py" <profile> --query "<current_query>" --batch-out "$batch_file" --no-dedup [--page-token <token>] [--batch-size <SEARCH_BATCH_SIZE> if overridden]
```
Parse stdout as JSON. On exit code 1: report the error and stop.

3b-ii. Update counters: `pages_fetched += 1`, `total_results += total_fetched`.

3b-iii. Set `page_token = next_page_token` from script output. If null: break inner loop (sub-query exhausted).

Always run all sub-queries in full — no early exit across sub-queries.

### Phase 3-PROCESS — Dedup, Fetch Full JD, and Process Each Job

If batch file is empty (no jobs returned): output "No jobs returned from search." and proceed to Step 4.

Read the batch file line by line (NDJSON). **For each job object:**

**3c. Dedup check:**

Extract `candidate_urls` from `raw.apply_links[].link` and `apply_link` (may be empty).

- **OB1:** Call `check_position_seen(source_url=<first candidate_url or null>, company_name=<raw.company_name>, role_title=<raw.title>)`
  - `seen=true AND is_repost=false`: call `log_ingested_position(..., outcome='duplicate', search_run_id=<search_run_id>)`, increment `duplicate_count`, output `= <Company> — <Role> [already seen]`, continue to next job
  - `seen=true AND is_repost=true`: call `log_ingested_position(..., outcome='duplicate', is_repost=true, first_seen_at=<result.first_seen_at>, search_run_id=<search_run_id>)`, increment `duplicate_count` and `repost_count`, append to `repost_jobs`, output `~ <Company> — <Role> [repost — first seen <first_seen_at>]`, continue to next job
  - `seen=false`: continue below

- **Local:** Check in-memory dedup set for: (1) URL exact match, (2) `lower(company):lower(role)` exact match
  - Match found: append `source_url,company_name,role_title,<profile>,duplicate,,false,,<now_iso>` to CSV, increment `duplicate_count`, output `= <Company> — <Role> [already seen]`, continue to next job
  - No match: continue below

**3d. Extract apply links** (for non-duplicate jobs):
- If `candidate_urls` is empty: `fetch_result = "no_url"`, `full_jd_content = null` → jump to **3f (Failure)**

**3e. Attempt to fetch the full JD:**

Do NOT use `sharing_link` — it is a Google search URL that returns HTTP 500 once the job leaves Google's index.

For each `url` in `candidate_urls` (in order):

- **Try WebFetch first.** If the response title/body contains login-wall signals (`"sign in"`, `"log in"`, `"authwall"`, `"join now"`, `"join to see"`, `"please sign in"`, `"sign in to view"`, `"create an account"`) or the URL contains auth path segments (`signin`, `login`, `signup`, `join`, `authwall`, `challenge`): skip WebFetch, fall through.
- **If WebFetch succeeded:** `fetch_result = "success"`, `full_jd_content = <response body>`, `fetch_url = url` — stop iterating URLs for this job.
- **Fall back to fetch-jd.py:**
  ```bash
  "$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out - "<url>"
  ```
  - Exit 0: `fetch_result = "success"`, `full_jd_content = stdout`, `fetch_url = url` — stop iterating
  - Exit 2: auth required — continue to next URL
  - Exit 3: job closed — do NOT create a folder; output: `- <Company> — <Role> [skipped — job closed]`; increment `closed_count`; continue to **next job**
  - Exit 1 or other: `fetch_result = "failed"` — continue to next URL

If all URLs exhausted without success: `full_jd_content = null`

**3f. Failure handling** (when `full_jd_content == null`):

Derive folder slug: `YYYY-MM-DD-<company-slug>-<role-slug>`.

Compose and save a minimal fetch-failed stub:

`notes_content`:
```markdown
# Notes — <Company> — <Role Title>

**Status:** Pending Review
**Status Detail:** Fetch failed — <fetch_result: "no_url" | "auth_required" | "failed"> — full JD not available
**Source:** SearchAPI / Google Jobs — /ingest <profile>
**Date:** YYYY-MM-DD

## Search Snippet

<If raw.job_highlights present: render each highlight group as subheading + bullets. If absent: "_No highlights available from search result._">

## Next Steps
- [ ] Manually locate apply link and paste JD to continue processing, or re-run /ingest after auth setup
```

`jd_fallback_content`:
```markdown
**Source:** SearchAPI / Google Jobs (full JD fetch failed — <fetch_result>)
**Date:** YYYY-MM-DD

---

# <raw.title> — <raw.company_name>

## Overview

| Field | Value |
|---|---|
| Company | <raw.company_name> |
| Location | <raw.location> |
| Via | <raw.via, or "Not listed"> |
| Employment Type | <raw.extensions.schedule_type or "Not listed"> |
| Salary | <raw.extensions.salary or "Not listed"> |
| Posted | <raw.detected_extensions.posted_at or "Not listed"> |

## Description

<raw.description verbatim, or "_No description available._" if absent>

<For each group in raw.job_highlights (if present): ## <group.title> + bullets>

## Apply Links

<one bullet per apply link; "_No apply links available._" if none>
```

**OB1:**
- `upload_file('applications/<folder>/search-result.json', <raw_json verbatim>, 'application/json')`
- `upload_file('applications/<folder>/notes.md', notes_content, 'text/markdown')`
- `upload_file('applications/<folder>/jd-<company>-<role>.md', jd_fallback_content, 'text/markdown')`
- `upsert_company(name=<company>, slug=<company-slug>)`
- `create_application(company_name=<company>, role_title=<role>, folder_prefix='applications/<folder>/', profile_slug=<profile>, status='pending-review', status_detail='Fetch failed — <fetch_result>')`
- `log_ingested_position(source_url=<first_url or null>, company_name=<company>, role_title=<role>, profile_slug=<profile>, search_run_id=<search_run_id>, application_id=<new_app_id>, outcome='fetch-failed', no_fit_reason=<fetch_result>)`

**Local:**
- `mkdir "$APPLICANT_DIR/applications/<folder>/"`
- Write `search-result.json` (raw verbatim), `notes.md`, `jd-<company>-<role>.md`
- Append to `application-tracker.md` Active Applications: `| YYYY-MM-DD | <Company> | <Role> | <profile> | SearchAPI | Pending Review | Fetch failed — <reason> | Review JD | — |`
- Append `<first_url or "">,<company>,<role>,<profile>,fetch-failed,<fetch_result>,false,,<now_iso>` to `ingested-positions.csv`; add to in-memory dedup set

- Increment `fetch_failed_count`; append `{company, title, location, reason}` to `fetch_failed_jobs`
- Output: `! <Company> — <Role> [fetch failed — <fetch_result>]`
- Continue to next job

**3g. Process the JD** (when `full_jd_content != null`):

Increment `screened`.

Call workflow `process-jd` with:
- `jd_content = full_jd_content`
- `source_url = fetch_url`
- `source_name = "SearchAPI / Google Jobs — /ingest <profile>"`
- `profile_hint = <profile>` (the profile being searched)
- `source_metadata = {via: raw.via, posted_at: raw.detected_extensions.posted_at, raw_source_json: <raw field verbatim>}`

`process-jd` returns `{folder_slug, application_id, verdict, score, profile_match}`.

**After process-jd resolves (both fit and no-fit):**

- **OB1:** `log_ingested_position(source_url=<fetch_url>, company_name=<company>, role_title=<role>, profile_slug=<profile>, search_run_id=<search_run_id>, application_id=<application_id if fit else null>, outcome=<verdict>, no_fit_reason=<score and reason if no-fit>)`
- **Local:** Append row to `ingested-positions.csv`; add to in-memory dedup set

- Output one line:
  - Fit: `+ <Company> — <Role> → applications/<folder_slug>/`
  - No-fit: `- <Company> — <Role> [no fit — score N/10]`
- Increment `fit_count` (fit) or `no_fit_count` (no-fit)

After all jobs in batch are processed, delete the batch file:
```bash
rm -f "$batch_file"
```

## Step 4 — Write Summary and Log Run Stats

`search_query` = all sub-queries joined with ` | `.
`summary_filename` = `YYYY-MM-DD-HHMMSS-<profile>-summary.md` (from run start time).

**4a — Generate summary `.md`** (always, both OB1 and local):

```markdown
# Search Summary — <profile> — YYYY-MM-DD HH:MM:SS

**Profile:** <profile>
**Sub-queries run:** <number>
**Date:** YYYY-MM-DD HH:MM:SS
**Pages fetched:** <pages_fetched>
**Total results:** <total_results>
**New (deduped):** <new_after_dedup>
**Screened:** <screened>
**Fit:** <fit_count>
**No fit:** <no_fit_count>
**Fetch failed:** <fetch_failed_count>
**Closed (job no longer available):** <closed_count>

## Sub-queries

<numbered list of all sub_queries>

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

**4b — Log run stats:**

**OB1:** `log_search_run(profile_slug=<profile>, query=<search_query>, pages_fetched=<pages_fetched>, total_results=<total_results>, new_after_dedup=<screened+fetch_failed_count>, screened=<screened>, fit_count=<fit_count>, summary_key=<storage_key>)` → capture returned `search_run_id`

**Local:** Append to `$APPLICANT_DIR/search/search-log.csv` (create with header if missing):
```
date,time,profile,pages_fetched,total_results,screened,fit_count,fetch_failed,duplicate_count,query
```

## Step 5 — Report

```
Ingestion complete — <profile>
  Sub-queries run:   <number>
  Pages fetched:     <pages_fetched>
  Jobs returned:     <total_results>
  Screened:          <screened>
  Fit:               <fit_count>
  No fit:            <no_fit_count>
  Duplicates:        <duplicate_count>
  Fetch failed:      <fetch_failed_count>
  Closed (skipped):  <closed_count>
```

If `repost_count > 0`: append a "Reposts detected" section listing companies/roles that were first seen >60 days ago (user may want to re-evaluate).

If `fit_count < SEARCH_TARGET_FITS`: append "Results exhausted — fewer than target fits found."

## Rules

- Do not auto-generate resumes. Fit jobs are saved as stubs for the applicant to review.
- Try WebFetch first on each apply URL before falling back to fetch-jd.py. Check for login-wall signals before accepting WebFetch output.
- `search-result.json` is written for every job that gets a folder (fit, no-fit, and fetch-failed).
- Call `log_ingested_position` for EVERY job processed (including duplicates and fetch-failed). This is the audit trail.
- The Python script must be called with `--no-dedup` to prevent it from writing/reading `seen-jobs.json`. All dedup logic lives in this workflow.
- Do not fabricate company, role, or location data.
- Always pass `--query "<current_query>"` to the script — never rely on the script's table-lookup.
- Use `$PLAYWRIGHT_PYTHON` (not system python3) to run the scripts.
