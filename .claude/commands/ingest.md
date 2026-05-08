Search Google Jobs for a profile and save fit jobs as application stubs for review.

USAGE
    /ingest                   — list available profiles and prompt for selection
    /ingest <profile-slug>    — search that profile (e.g. /ingest presales-se)

Available profile slugs: presales-se, ai-governance-se, post-sales-se, ai-transformation-consultant, technical-enablement

---

EXECUTION STEPS — run in order without asking for confirmation

**Step 1 — Load context**
- Read `$APP_DIR/.env`, resolve `$APP_DIR`, `$APPLICANT_DIR`, `SEARCHAPI_KEY`, `SEARCH_TARGET_FITS` (default 10), `SEARCH_BATCH_SIZE` (default 10)
- Read `$APPLICANT_DIR/applicant.md` for location/comp hard-stops
- Read `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`; confirm the profile exists and has at least one search query row in the `## Search Queries` table
- Extract ALL rows for this profile from the `## Search Queries` table into an ordered list `sub_queries`. Each row has the same profile slug in the left column and a backtick-quoted query string in the right column. There will be 2–3 rows per profile.
- If no profile argument: list the 5 available profiles and ask the user to choose one. Then proceed.

**Step 2 — Initialize counters**
```
fit_count = 0
pages_fetched = 0
total_results = 0
new_after_dedup = 0
screened = 0
screened_jobs = []   # all screened jobs — populated after Phase 3-SCREEN, fit and no-fit
all_new_jobs = []    # accumulates new_jobs across ALL pages and sub-queries for batch screening
```

**Step 3 — Two-phase execution: fetch all pages, then screen once**

### Phase 3-FETCH — fetch all pages for all sub-queries

Iterate over each entry in `sub_queries`. For each `current_query`:

  3a. Set `page_token = null` for this sub-query.

  3b. **Pagination loop** (repeat until no more pages for this sub-query):

  3b-i. Run the search script:
  ```bash
  "$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/search-jobs.py" <profile> --query "<current_query>" [--page-token <token>]
  ```
  Parse stdout as JSON. On exit code 1, report the error and stop.

  3b-ii. Update counters from script output:
  - `pages_fetched += 1`
  - `total_results += total_fetched`
  - `new_after_dedup += total_new`
  - `screened += len(new_jobs)`

  3b-iii. Extend `all_new_jobs` with `new_jobs` from this page.

  3b-iv. Set `page_token = next_page_token` from script output. If null: break inner loop (sub-query exhausted).

Always run all sub-queries in full — no early exit across sub-queries.

### Phase 3-SCREEN — one Haiku call for all accumulated jobs

If `all_new_jobs` is empty: output "No new jobs to screen." and proceed to Step 4.

Before spawning Haiku, extract from the source files:
- From `$APPLICANT_DIR/applicant.md`: the "Location" section, "Deal-breakers (Hard No)" section, and the compensation/target salary line only — do not pass the full file
- From `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`: the `## Hard Stops` section and `## Location Check` section only — do not pass the full file

Spawn **ONE** Haiku agent with:
- All jobs from `all_new_jobs`. For each job's `description`: pass the first 3,000 characters and the last 3,000 characters (if the description is under 6,000 characters, pass it in full). This ensures the opening role/company content and the trailing comp/location/travel sections are both visible. Other fields: title, company, location, apply_link, posted_at.
- The extracted criteria sections above (~500 bytes total)
- Instruction: for each job, return `fit` (true/false), `profile_score` (1–10), `profile_match` (profile slug), and `no_fit_reason` (if false). Apply Hard Stops first — any Hard Stop hit = no-fit regardless of score. Return fit=true only if score >= 7 and no Hard Stop applies.

After Haiku returns, populate `screened_jobs` from all results:
```
{ company, title, location, profile_score, fit, no_fit_reason (if fit=false), folder: null }
```

### Phase 3-SAVE — create application stubs for fit jobs

For each **fit** job (profile_score >= 7) in Haiku results:
  - Derive folder slug: `YYYY-MM-DD-<company-slug>-<role-slug>` (today's date; slugify: lowercase, spaces → hyphens, strip special chars)
  - Create `$APPLICANT_DIR/applications/<folder>/`
  - Write `job-description.md`:
    ```markdown
    # <Company> — <Role Title>

    **Profile match:** <profile_slug> (score: N/10)
    **Source:** SearchAPI / Google Jobs
    **Status:** Found via search — pending review
    **Date found:** YYYY-MM-DD
    **Apply link:** <url>
    **Posted:** <posted_at>

    ## Location
    <location>

    ## Compensation
    <comp if present, else "Not listed">

    ## Requirements Summary
    <2–4 sentence summary of key requirements from description>

    ## Fit Reasoning
    <Haiku's fit reasoning>
    ```
  - Write `jd-<company>-<role>.md`: verbatim description text from search result (the `description` field — full text, not truncated)
  - Write `search-result.json`: the `raw` field from the job object (full SearchAPI job object)
  - Write `notes.md`:
    ```markdown
    # Notes — <Company> — <Role Title>

    **Status:** Found via search — pending review
    **Source:** SearchAPI / Google Jobs — /ingest <profile>
    **Date found:** YYYY-MM-DD
    **Profile match:** <profile_slug> (score: N/10)

    ## JD Analysis
    _Pending full review. See job-description.md for requirements summary._

    ## Fit Assessment
    <Haiku screening reasoning>

    ### Domain Connection
    _To be completed during full review._

    ## Next Steps
    - [ ] Review full JD
    - [ ] Confirm fit and domain connection
    - [ ] Generate resume if proceeding
    ```
  - Update `$APPLICANT_DIR/application-tracker.md`: add row to Active Applications table:
    `| YYYY-MM-DD | <Company> | <Role> | <profile_slug> | SearchAPI | Found via search — pending review | Review JD | — |`
  - Set `folder` on this job's entry in `screened_jobs` to `applications/<folder>/`
  - Output one line: `+ <Company> — <Role> → applications/<folder>/`
  - Increment `fit_count`

**Step 4 — Write summary file and log to CSV**

Capture `run_timestamp` once: `YYYY-MM-DD-HHMMSS` (e.g. `2026-05-08-100703`).
Derive `summary_filename = <run_timestamp>-<profile>-summary.md`.
`search_query` for logging = all sub-queries joined with ` | ` (e.g. `"Solutions Engineer" OR ... | "Solutions Architect" OR ...`).

4a. Write `$APPLICANT_DIR/search/<summary_filename>`:
```markdown
# Search Summary — <profile> — YYYY-MM-DD HH:MM:SS

**Profile:** <profile>
**Sub-queries run:** <number of sub_queries actually executed>
**Date:** YYYY-MM-DD HH:MM:SS
**Pages fetched:** <pages_fetched>
**Total results:** <total_results>
**New (deduped):** <new_after_dedup>
**Screened:** <screened>
**Fit:** <fit_count>

## Sub-queries
<numbered list of all sub_queries for this profile — all are always run>

## Fit Jobs (score >= 7)

| Company | Role | Location | Score | Folder |
|---------|------|----------|-------|--------|
<one row per fit job from screened_jobs where fit=true>

_No fit jobs found._ (use this line only if fit_count == 0, instead of the table)

## No-Fit Jobs

| Company | Role | Location | Score | Reason |
|---------|------|----------|-------|--------|
<one row per no-fit job from screened_jobs where fit=false>
```

4b. Append one row to `$APPLICANT_DIR/search/search-log.csv`. Create the file with header if it does not exist:
```
date,time,profile,pages_fetched,total_results,new_after_dedup,screened,fit_count,query,summary_file
```
Row values: today's date (YYYY-MM-DD), current time (HH:MM:SS), profile slug, final counter values, `search_query` (CSV-quoted: wrap in `"`, escape any internal `"` as `""`), and `summary_filename`.

**Step 5 — Report**

Output:
```
Ingestion complete — <profile>
  Sub-queries run:  <number run>
  Pages fetched:    <pages_fetched>
  Jobs returned:    <total_results>
  New (deduped):    <new_after_dedup>
  Screened:         <screened>
  Fit:              <fit_count>
  Summary: $APPLICANT_DIR/search/<summary_filename>
  Log: $APPLICANT_DIR/search/search-log.csv
```
If fit_count < SEARCH_TARGET_FITS: add note "Results exhausted — fewer than target fits found."

---

RULES
- Do not auto-generate resumes. Fit jobs are saved as stubs for the applicant to review.
- Do not skip the deduplication check — the script handles it via seen-jobs.json; pass the page_token correctly and always pass --query so each sub-query's results are attributed correctly.
- Do not fabricate company, role, or location data — use only what the search result contains.
- If SEARCHAPI_KEY is not set in .env, tell the user to add it and stop.
- The `$PLAYWRIGHT_PYTHON` interpreter has the required dependencies (requests, etc.). Use it to run the script.
- Always pass `--query "<current_query>"` to the script — never rely on the script's table-lookup when running from /ingest, since the table now has multiple rows per profile.
