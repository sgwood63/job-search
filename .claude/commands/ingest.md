Search Google Jobs for a profile and save fit jobs as application stubs for review.

USAGE
    /ingest                              — list available profiles and prompt for selection
    /ingest <profile-slug>               — search that profile (e.g. /ingest presales-se)
    /ingest <profile-slug> --fits N      — override SEARCH_TARGET_FITS for this run
    /ingest <profile-slug> --batch N     — override SEARCH_BATCH_SIZE for this run

Available profile slugs: presales-se, ai-governance-se, post-sales-se, ai-transformation-consultant, technical-enablement

---

EXECUTION STEPS — run in order without asking for confirmation

**Step 1 — Load context**
- Read `$APP_DIR/.env`, resolve `$APP_DIR`, `$APPLICANT_DIR`, `SEARCHAPI_KEY`, `SEARCH_TARGET_FITS` (default 10), `SEARCH_BATCH_SIZE` (default 10)
- Parse invocation arguments: if `--fits N` was provided, override `SEARCH_TARGET_FITS` with N; if `--batch N` was provided, override `SEARCH_BATCH_SIZE` with N
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
run_timestamp = <capture now as YYYYMMDD-HHMMSS>
batch_file = "$APPLICANT_DIR/search/tmp-<profile>-<run_timestamp>.json"   # written during fetch, deleted after save
```

**Step 3 — Two-phase execution: fetch all pages, then screen once**

### Phase 3-FETCH — fetch all pages for all sub-queries

Iterate over each entry in `sub_queries`. For each `current_query`:

  3a. Set `page_token = null` for this sub-query.

  3b. **Pagination loop** (repeat until no more pages for this sub-query):

  3b-i. Run the search script:
  ```bash
  "$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/search-jobs.py" <profile> --query "<current_query>" --batch-out "$batch_file" [--page-token <token>] [--batch-size <SEARCH_BATCH_SIZE> if overridden]
  ```
  Parse stdout as JSON. On exit code 1, report the error and stop.

  3b-ii. Update counters from script output:
  - `pages_fetched += 1`
  - `total_results += total_fetched`
  - `new_after_dedup += total_new`
  - `screened += total_new`

  3b-iii. Set `page_token = next_page_token` from script output. If null: break inner loop (sub-query exhausted).

Always run all sub-queries in full — no early exit across sub-queries.

### Phase 3-SCREEN — one Haiku call for all accumulated jobs

If `screened` is 0 (batch file is empty or was never written): output "No new jobs to screen." and proceed to Step 4.

Before spawning Haiku, extract from the source files:
- From `$APPLICANT_DIR/applicant.md`: the "Location" section, "Deal-breakers (Hard No)" section, and the compensation/target salary line only — do not pass the full file
- From `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`: the `## Hard Stops` section and `## Location Check` section only — do not pass the full file

Spawn **ONE** Haiku agent with:
- Instruction to read the batch file at `$batch_file`. The file is newline-delimited JSON (one job object per line). For each job's `description`: use the first 3,000 characters and the last 3,000 characters (if under 6,000 characters, use it in full). If `description` is empty, use `job_highlights` fields. Other fields to use: title, company, location, apply_link, posted_at, `job_highlights`.
- The extracted criteria sections above (~500 bytes total)
- Instruction: for each job, return a JSON object with all of the following fields. Apply Hard Stops first — any Hard Stop hit = no-fit regardless of score. Return fit=true only if score >= 7 and no Hard Stop applies.

  IMPORTANT: Your JSON output fields are used verbatim to fill a prescribed template. Do not summarize or truncate lists — completeness matters for downstream use.

  ```
  fit               — true/false
  profile_score     — 1–10
  profile_match     — profile slug
  employment_type   — "Full-time" / "Contract" / "Part-time" / "Not listed"
  seniority         — level as written in JD, or inferred (e.g. "Senior", "Mid-Senior"), or "Not listed"
  travel            — travel requirement as stated, or "Not listed"
  compensation      — comp range as stated, or "Not listed"
  role_summary      — 2–3 sentence paragraph: what the role does and who it serves
  responsibilities  — array of ALL distinct responsibilities stated in the JD (not a sample)
  must_have         — array of {text, gap} objects for ALL must-have/required qualifications; gap=true if applicant has a clear deficiency vs. that requirement
  preferred         — array of ALL preferred/nice-to-have qualifications stated in JD (omit array if none stated)
  fit_reasoning     — narrative paragraph explaining fit or no-fit (replaces no_fit_reason)
  coverage          — for fit=true jobs only: array of {requirement, status} where status ∈ ["✅ Strong", "⚠️ Partial", "❌ Gap"]; 3–8 key requirements; omit array for no-fit jobs
  ```

After Haiku returns, populate `screened_jobs` by merging Haiku's results with the batch file. Read the batch file (NDJSON) and for each job Haiku screened, match by company + title (case-insensitive) to retrieve the full job object. Store:
```
{ company, title, location, profile_score, fit, folder: null,
  employment_type, seniority, travel, compensation,
  role_summary, responsibilities, must_have, preferred, fit_reasoning, coverage,
  description, apply_link, posted_at, raw }
```
This ensures Phase 3-SAVE has all extracted fields and the raw object available without re-reading the batch file per job.

### Phase 3-SAVE — create application stubs for fit jobs

For each **fit** job (profile_score >= 7) in Haiku results:
  - Derive folder slug: `YYYY-MM-DD-<company-slug>-<role-slug>` (today's date; slugify: lowercase, spaces → hyphens, strip special chars)
  - Create `$APPLICANT_DIR/applications/<folder>/`

  **FETCH FULL JD** (before writing any files):

  Do NOT use `sharing_link` — it is a Google search URL with session parameters that returns HTTP 500 once the job leaves Google's index. Only use direct apply URLs.

  - Build `candidate_urls` list:
    - If `raw.apply_links` is present and non-empty: add each `raw.apply_links[].link` in order
    - If `apply_link` is present and not already in the list: append it
    - If `candidate_urls` is empty: set `fetch_result = "no_url"`, `full_jd_content = null` — skip to writing files
  - For each `url` in `candidate_urls` (in order):
    ```bash
    "$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out - "<url>"
    ```
    - Exit code 0: `fetch_result = "success"`, `full_jd_content = stdout`, `fetch_url = url` — stop iterating
    - Exit code 2: `fetch_result = "auth_required"` — continue to next url
    - Exit code 3: job is closed/no longer available — stop iterating all URLs for this job; skip it entirely (do not create folder, do not write any files, do not add to tracker); output one line: `- <Company> — <Role> [skipped — job closed/no longer available]`; do NOT increment fit_count; continue to next fit job
    - Exit code 1 or other: `fetch_result = "failed"` — continue to next url
  - If all urls exhausted without exit code 0: `full_jd_content = null` (`fetch_result` retains last non-zero result)

  **Write `job-description.md`:**

  **Path 1 — Full JD available (`fetch_result == "success"`):**
  Read `full_jd_content` and generate a rich structured file. Use Haiku's fit/score/coverage/gap fields for the assessment sections; extract company context, full responsibilities, and full requirements from the fetched JD text.
    ```markdown
    # <Company> — <Role Title>

    **Profile match:** <profile_slug> (score: N/10)
    **Source:** SearchAPI / Google Jobs + full JD fetch
    **Apply link:** <fetch_url>
    **Status:** Found via search — pending review
    **Date found:** YYYY-MM-DD

    ---

    ## Key Info

    | Field | Value |
    |---|---|
    | Company | <company — use full JD value if more specific than SearchAPI> |
    | Role | <role_title> |
    | Location | <location> |
    | Employment Type | <employment_type — from Haiku> |
    | Seniority | <seniority — from Haiku> |
    | Compensation | <compensation — from full JD if available, else Haiku> |
    | Travel | <travel — from full JD if available, else Haiku> |
    | Posted | <posted_at or "Not listed"> |

    ---

    ## Company Overview

    <Extract 2–4 sentences from full JD about what the company does, industry, and customer base.
    If posted via a recruiting agency (e.g. Jobot, Robert Half), note the likely employer and confidence level.
    Omit this section if the full JD contains no company description.>

    ---

    ## Role Summary

    <role_summary from Haiku, or re-extract from full JD if Haiku's is thin (under 2 sentences)>

    ---

    ## Key Responsibilities

    <Extract ALL distinct responsibilities from the full JD as bullets.
    If the JD groups them by subsection (e.g. Pre-Sales, Architecture, Implementation), preserve those subheadings.
    Do not limit to 5–8 — include every distinct responsibility stated.>

    ---

    ## Requirements

    ### Must Have
    - <requirement text> [append "⚠️ GAP" if Haiku flagged gap=true for a matching requirement]
    <Use the full requirements list from the fetched JD. Overlay Haiku's gap=true flags where requirement text matches.
    Omit section if no required qualifications are stated.>

    ### Preferred / Nice-to-Have
    - <preferred requirement>
    <From full JD preferred/nice-to-have section. Omit section if none stated.>

    ---

    ## Benefits

    - <benefit bullet>
    <From full JD benefits section. Omit section if none listed.>

    ---

    ## Fit Assessment

    **Profile**: <profile_slug>
    **Score**: N/10

    <fit_reasoning from Haiku>

    ---

    ## Coverage Assessment

    | Requirement | Coverage |
    |---|---|
    | <requirement> | <✅ Strong / ⚠️ Partial / ❌ Gap> |
    (one row per coverage item from Haiku; omit entire section if coverage array is empty or absent)
    ```

  **Path 2 — Fetch failed (`fetch_result != "success"`):**
  Populate from Haiku output only, following this template exactly:
    ```markdown
    # <Company> — <Role Title>

    **Profile match:** <profile_slug> (score: N/10)
    **Source:** SearchAPI / Google Jobs
    **Status:** Found via search — pending review
    **Date found:** YYYY-MM-DD
    **Apply link:** <apply_link or "Not available — check company careers page directly">

    ---

    ## Key Info

    | Field | Value |
    |---|---|
    | Company | <company> |
    | Role | <role_title> |
    | Location | <location> |
    | Employment Type | <employment_type> |
    | Seniority | <seniority> |
    | Compensation | <compensation> |
    | Travel | <travel> |
    | Posted | <posted_at or "Not listed"> |

    ---

    ## Role Summary

    <role_summary — if empty: "Role summary not available from search result.">

    ---

    ## Key Responsibilities

    - <bullet from responsibilities array>
    (one bullet per item; omit section if responsibilities array is empty)

    ---

    ## Must Have Requirements

    - <text> [append " ⚠️ GAP" if gap=true]
    (one bullet per must_have item; omit section if must_have array is empty)

    ---

    ## Preferred / Nice-to-Have

    - <bullet from preferred array>
    (one bullet per item; omit entire section if preferred array is empty or absent)

    ---

    ## Fit Assessment

    **Profile**: <profile_slug>
    **Score**: N/10

    <fit_reasoning>

    ---

    ## Coverage Assessment

    | Requirement | Coverage |
    |---|---|
    | <requirement> | <status> |
    (one row per coverage item; omit entire section if coverage array is empty or absent)
    ```

  **Write `jd-<company>-<role>.md`:**
  - **If `fetch_result == "success"`**: write the fetched markdown content as-is. Prepend:
    ```
    **Source:** <fetch_url> (fetched via fetch-jd.py)
    **Date fetched:** YYYY-MM-DD

    ---

    ```
  - **If `fetch_result == "auth_required"`**: prepend `_Note: All apply URLs require authentication — content below is from SearchAPI and may be truncated._` followed by a blank line, then write SearchAPI content using the HTML-to-markdown rules below.
  - **If `fetch_result == "failed"` or `"no_url"`**: prepend `_Note: Full JD fetch failed (no apply URLs available or all failed) — content below is from SearchAPI and may be truncated._` followed by a blank line, then write SearchAPI content using the HTML-to-markdown rules below.

  **SearchAPI HTML-to-markdown fallback rules** (used when fetch did not succeed):
    - **If description contains HTML tags**: convert to markdown:
      - `<h2>` or `<h3>` → `## text` (all JD heading levels are treated as top-level section headers)
      - `<p><strong>text</strong></p>` or `<p><b>text</b></p>` (standalone bold paragraph — section header) → `## text`
      - `<strong>text</strong>` or `<b>text</b>` inline → `**text**`
      - `<em>text</em>` or `<i>text</i>` → `_text_`
      - `<ul>` / `</ul>` → structural only, no output
      - `<ol>` / `</ol>` → structural only; items become numbered list (1. 2. 3...)
      - `<li>` in `<ul>` (including `<li><p>text</p></li>`) → `- text`
      - `<li>` in `<ol>` → `N. text` (increment per item)
      - `<p style="min-height:1.5em"></p>` or other empty `<p>` → skip
      - `<p>text</p>` → text followed by a blank line
      - `<a href="url">text</a>` → `[text](url)`
      - `<u>text</u>` → text (drop underline)
      - `<br />`, `<br>`, `<br><br>` → newline (`<br><br>` = blank line between paragraphs)
      - `<div>` / `</div>` and `<span style="...">` → structural only, no output
      - HTML entities (`&rsquo;` → `'`, `&amp;` → `&`, `&nbsp;` → space, `&ndash;` → `–`, etc.) → decoded
      - Strip all remaining HTML tags, preserving their text content
      - Result must mirror the visual structure: section headers, bullets, bold labels
    - **If description is plain text (no HTML tags)**: write as-is with markdown paragraph breaks. If `raw.job_highlights` is present, prepend structured sections (`## Responsibilities`, `## Qualifications`, etc.) using its bullet items.
    - **If description is empty**: use `raw.job_highlights` to write structured sections with bullet lists. Append: `_Note: Full JD not available from search API — content from job highlights only._`

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

Delete the batch file now that screening and saving are complete:
```bash
rm -f "$batch_file"
```

**Step 4 — Write summary file and log to CSV**

`run_timestamp` was captured in Step 2; format it as `YYYY-MM-DD-HHMMSS` (e.g. `2026-05-08-100703`) for use in filenames.
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
