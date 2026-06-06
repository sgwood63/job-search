Search Google Jobs for a profile and save fit jobs as application stubs for review.

USAGE
    /ingest                              — list available profiles and prompt for selection
    /ingest <profile-slug>               — search that profile (e.g. /ingest presales-se)
    /ingest <profile-slug> --fits N      — override SEARCH_TARGET_FITS for this run
    /ingest <profile-slug> --batch N     — override SEARCH_BATCH_SIZE for this run

Available profiles: discovered at runtime from $APPLICANT_DIR/profiles/ subdirectories

---

CONTENTS
    Step 1 — Load context (applicant.md, profiles, env vars)
    Step 2 — Initialize counters
    Step 3 — Two-phase execution
        Phase 3-FETCH — paginate all sub-queries, build batch file
        Phase 3-PROCESS — per job: fetch JD → screen (Haiku) → write files
            3c. Extract apply links
            3d. Fetch real JD
            3e. Failure handling (no URL / fetch failed)
            3f. Screen on real JD (Haiku agent, JSON output)
            3g. Write application files (job-description.md, jd-*.md, search-result.json, notes.md)
    Step 4 — Write summary file + log to CSV
    Step 5 — Report
    RULES

EXECUTION STEPS — run in order without asking for confirmation

**Step 1 — Load context**
- Read `$APP_DIR/.env`, resolve `$APP_DIR`, `$APPLICANT_DIR`, `SEARCHAPI_KEY`, `SEARCH_TARGET_FITS` (default 10), `SEARCH_BATCH_SIZE` (default 10)
- Read `DATA_BACKEND` from `.env` (default: `local`). Apply routing rule per `memory/feedback_ob1_integration.md` for every APPLICANT file operation in this command.
- Parse invocation arguments: if `--fits N` was provided, override `SEARCH_TARGET_FITS` with N; if `--batch N` was provided, override `SEARCH_BATCH_SIZE` with N
- Load `applicant.md` for location/comp hard-stops:
  - OB1: `get_file('applicant.md')`
  - Local: read `$APPLICANT_DIR/applicant.md`
- Load `PROFILES-QUICK-REFERENCE.md`; confirm the profile exists and has at least one search query row in the `## Search Queries` table:
  - OB1: `get_file('profiles/PROFILES-QUICK-REFERENCE.md')`
  - Local: read `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
- Extract ALL rows for this profile from the `## Search Queries` table into an ordered list `sub_queries`. Each row has the same profile slug in the left column and a backtick-quoted query string in the right column. There will be 2–3 rows per profile.
- If no profile argument: derive profile slugs from the loaded PROFILES-QUICK-REFERENCE.md profile column (OB1), or run `ls -d "$APPLICANT_DIR/profiles"/*/` (local); exclude `base-documents`; present the resulting profile slugs to the user and ask them to choose one. Then proceed.

**Step 2 — Initialize counters**
```
fit_count = 0
no_fit_count = 0
fetch_failed_count = 0
closed_count = 0
pages_fetched = 0
total_results = 0
new_after_dedup = 0
screened = 0
fetch_failed_jobs = []   # {company, title, location, reason}
run_timestamp = <capture now as YYYYMMDD-HHMMSS>
batch_file = "$APPLICANT_DIR/search/tmp-<profile>-<run_timestamp>.json"   # written during fetch, deleted after save
```

**Step 3 — Two-phase execution: fetch all pages, then process each job**

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

  3b-iii. Set `page_token = next_page_token` from script output. If null: break inner loop (sub-query exhausted).

Always run all sub-queries in full — no early exit across sub-queries.

### Phase 3-PROCESS — fetch the real JD and screen every new job

If `new_after_dedup` is 0 (batch file is empty or was never written): output "No new jobs to screen." and proceed to Step 4.

Before entering the loop, extract from the already-loaded files (Step 1) once and reuse across all jobs:
- From `applicant.md`: the "Location" section, "Deal-breakers (Hard No)" section, and the compensation/target salary line only
- From `PROFILES-QUICK-REFERENCE.md`: the `## Hard Stops` section and `## Location Check` section only

Read the batch file line by line (NDJSON). **For each job object:**

**3c. Extract apply links:**
- Build `candidate_urls` list:
  - If `raw.apply_links` is present and non-empty: add each `raw.apply_links[].link` in order
  - If `apply_link` is present and not already in the list: append it
- If `candidate_urls` is empty: `fetch_result = "no_url"`, `full_jd_content = null` — jump to **3e (Failure)**

**3d. Attempt to fetch the full JD:**

Do NOT use `sharing_link` — it is a Google search URL that returns HTTP 500 once the job leaves Google's index.

For each `url` in `candidate_urls` (in order):

  - **Try WebFetch first:** attempt to retrieve the URL using the built-in WebFetch tool. If the response title or body contains login-wall signals ("sign in", "log in", "authwall", "join now", "join to see", "please sign in", "sign in to view", "create an account") or the URL itself contains auth path segments ("signin", "login", "signup", "join", "authwall", "challenge"): treat as auth-walled, skip WebFetch result, fall through to fetch-jd.py below.
  - **If WebFetch succeeded with real content:** `fetch_result = "success"`, `full_jd_content = <response body>`, `fetch_url = url` — stop iterating URLs for this job.
  - **If WebFetch failed or returned a login wall:** fall back to:
    ```bash
    "$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out - "<url>"
    ```
    - Exit code 0: `fetch_result = "success"`, `full_jd_content = stdout`, `fetch_url = url` — stop iterating
    - Exit code 2: auth required — continue to next URL
    - Exit code 3: job closed/no longer available — stop iterating all URLs for this job; do NOT create a folder; output one line: `- <Company> — <Role> [skipped — job closed/no longer available]`; increment `closed_count`; continue to next job in batch
    - Exit code 1 or other: `fetch_result = "failed"` — continue to next URL

- If all URLs exhausted without exit code 0: `full_jd_content = null` (retain last non-zero `fetch_result`)

**3e. Failure handling** (when `full_jd_content == null`):
- Derive folder slug: `YYYY-MM-DD-<company-slug>-<role-slug>` (today's date; slugify: lowercase, spaces → hyphens, strip special chars)
Compose `notes_content`:
  ```markdown
  # Notes — <Company> — <Role Title>

  **Status:** Pending Review
  **Status Detail:** Fetch failed — <fetch_result: "no_url" | "auth_required" | "failed"> — full JD not available
  **Source:** SearchAPI / Google Jobs — /ingest <profile>
  **Date found:** YYYY-MM-DD
  **Via:** <raw.via, or "Not listed" if absent>

  ## Search Snippet

  <If raw.job_highlights is present and non-empty: render each highlight group as a subheading with its items as bullets. Example:
  ### Qualifications
  - Requirement 1
  - Requirement 2

  ### Responsibilities
  - Responsibility 1

  If raw.job_highlights is absent: write "_No highlights available from search result._">

  ## Next Steps
  - [ ] Manually locate apply link and paste JD to continue processing, or re-run /ingest after auth setup
  ```

Compose `jd_fallback_content`:
  ```markdown
  **Source:** SearchAPI / Google Jobs (full JD fetch failed — <fetch_result: "no_url" | "auth_required" | "failed">)
  **Date:** YYYY-MM-DD

  ---

  # <raw.title> — <raw.company_name>

  ## Overview

  | Field | Value |
  |---|---|
  | Company | <raw.company_name> |
  | Location | <raw.location> |
  | Via | <raw.via, or "Not listed"> |
  | Employment Type | <raw.extensions.schedule_type or raw.detected_extensions.schedule_type, or "Not listed"> |
  | Salary | <raw.extensions.salary or raw.detected_extensions.salary, or "Not listed"> |
  | Posted | <raw.detected_extensions.posted_at, or "Not listed"> |

  ## Description

  <raw.description verbatim, or "_No description available from search result._" if absent or empty>

  <For each group in raw.job_highlights (if present and non-empty), emit a section:>
  ## <group.title>

  - <item> (one bullet per item in group.items)

  <If raw.job_highlights is absent or empty: omit the highlights sections entirely>

  ## Apply Links

  <If raw.apply_links is present and non-empty: one bullet per entry — `- [<link>](<link>)`>
  <If raw.apply_link is present and not already listed: add it as a bullet>
  <If no links at all: `_No apply links available._`>
  ```

**If OB1_MODE=true:**
- `upload_file('applications/<folder>/search-result.json', <raw_json>, 'application/json')` — `<raw_json>` is the exact, verbatim content of the `raw` field from the batch line: the original SearchAPI job object with ALL fields intact (title, company_name, location, via, extensions, detected_extensions, job_highlights, apply_links, apply_link, description, sharing_link, position, thumbnail — whatever the API returned). Copy the JSON character-for-character. Do NOT reconstruct, summarize, or omit any fields.
- `upload_file('applications/<folder>/notes.md', <notes_content>, 'text/markdown')`
- `upload_file('applications/<folder>/jd-<company>-<role>.md', <jd_fallback_content>, 'text/markdown')`
- `upsert_company(name=<company>, slug=<company-slug>)`
- `create_application(company_name=<company>, role_title=<role>, folder_prefix='applications/<folder>/', profile_slug=<profile>, status='pending-review', status_detail='Fetch failed — <fetch_result>')`

**If OB1_MODE=false (local):**
- Create `$APPLICANT_DIR/applications/<folder>/`
- Write `search-result.json`: the exact, verbatim content of the `raw` field from the batch line — the original SearchAPI job object with ALL fields intact. Do NOT reconstruct, summarize, or omit any fields.
- Write `notes.md` with the content above
- Write `jd-<company>-<role>.md` with `jd_fallback_content`
- Update `$APPLICANT_DIR/application-tracker.md`: add row to Active Applications:
  `| YYYY-MM-DD | <Company> | <Role> | <profile> | SearchAPI | Pending Review | Fetch failed — <reason> | Review JD | — |`

- Increment `fetch_failed_count`; append `{company, title, location, reason: fetch_result}` to `fetch_failed_jobs`
- Output one line: `! <Company> — <Role> [fetch failed — <fetch_result>]`
- Continue to next job

**3f. Screen on real JD** (when `full_jd_content != null`):

Increment `screened`.

Spawn a **Haiku agent** for this single job with:
- The full `full_jd_content` text
- The pre-extracted criteria sections from applicant.md and PROFILES-QUICK-REFERENCE.md
- Instruction: return a single JSON object with all of the following fields. Apply Hard Stops first — any Hard Stop hit = no-fit regardless of score. Return fit=true only if score >= 7 and no Hard Stop applies.

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
  fit_reasoning     — narrative paragraph explaining fit or no-fit
  coverage          — for fit=true jobs only: array of {requirement, status} where status ∈ ["✅ Strong", "⚠️ Partial", "❌ Gap"]; 3–8 key requirements; omit array for no-fit jobs
  ```

**3g. Create application folder and write files:**
- Derive folder slug: `YYYY-MM-DD-<company-slug>-<role-slug>` (today's date)

Compose the following file contents, then save per the OB1_MODE branch at the end of this step.

**`job-description.md`** content (full JD always available here):
```markdown
# <Company> — <Role Title>

**Profile match:** <profile_slug> (score: N/10)
**Source:** SearchAPI / Google Jobs + full JD fetch
**Apply link:** <fetch_url>
**Status:** <Pending Review (fit) | Closed (no-fit)>
**Status Detail:** <Found via search — pending review[⚠️ flag(s) if any] | No fit — [reason]>
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
(one row per coverage item from Haiku; omit entire section if coverage array is empty or absent, or if no-fit)
```

**`jd-<company>-<role>.md`** content:

> **HARD RULE:** Write `full_jd_content` VERBATIM — character-for-character. Do NOT summarize, extract, reformat, or paraphrase any part of it. No bullets, no headers, no edits. This is the archival raw source; `job-description.md` is the structured extraction. They are different files serving different purposes. Treat this like copying binary content.

The full, verbatim markdown content of the retrieved JD — no summarization, no editing, no truncation. Prepend with:
```
**Source:** <fetch_url> (fetched via <"WebFetch" if WebFetch succeeded | "fetch-jd.py --md-out" if script succeeded>)
**Date fetched:** YYYY-MM-DD

---

```
Then append `full_jd_content` character-for-character.

**`search-result.json`** content: the exact, verbatim content of the `raw` field from the batch line — the original SearchAPI job object with ALL fields intact (title, company_name, location, via, extensions, detected_extensions, job_highlights, apply_links, apply_link, description, sharing_link, position, thumbnail — whatever the API returned). Copy the JSON character-for-character. Do NOT reconstruct, summarize, or omit any fields. This is the only archival record of what the API returned for this job.

**`notes.md`** content:

For **no-fit** jobs:
```markdown
# Notes — <Company> — <Role Title>

**Status:** Closed
**Status Detail:** No fit — <brief reason>
**Source:** SearchAPI / Google Jobs — /ingest <profile>
**Date found:** YYYY-MM-DD
**Profile match:** <profile_slug> (score: N/10)

## Fit Assessment
<fit_reasoning from Haiku>
```

For **fit** jobs:
```markdown
# Notes — <Company> — <Role Title>

**Status:** Pending Review
**Status Detail:** Found via search — pending review[<⚠️ flag(s) if any>]
**Source:** SearchAPI / Google Jobs — /ingest <profile>
**Date found:** YYYY-MM-DD
**Profile match:** <profile_slug> (score: N/10)

## JD Analysis
_Pending full review. See job-description.md for requirements summary._

## Fit Assessment
<fit_reasoning from Haiku>

### Domain Connection
_To be completed during full review._

## Next Steps
- [ ] Review full JD
- [ ] Confirm fit and domain connection
- [ ] Generate resume if proceeding
```

**If OB1_MODE=true** — write to object store and register application:
- `upload_file('applications/<folder>/job-description.md', <content>, 'text/markdown')`
- `upload_file('applications/<folder>/jd-<company>-<role>.md', <content>, 'text/markdown')` (or `'application/pdf'` if source was a PDF)
- `upload_file('applications/<folder>/search-result.json', <raw_json>, 'application/json')`
- `upload_file('applications/<folder>/notes.md', <content>, 'text/markdown')`
- `upsert_company(name=<company>, slug=<company-slug>)`
- `create_application(company_name=<company>, role_title=<role>, folder_prefix='applications/<folder>/', profile_slug=<profile>, source_url=<fetch_url>, status=<'pending-review' (fit) | 'closed' (no-fit)>, status_detail=<'Found via search — pending review' (fit) | 'No fit — <brief reason>' (no-fit)>)`

**If OB1_MODE=false (local)** — write to disk and update tracker:
- Create `$APPLICANT_DIR/applications/<folder>/`
- Write `job-description.md`, `jd-<company>-<role>.md`, `search-result.json`, and `notes.md` with the content composed above
- Update `$APPLICANT_DIR/application-tracker.md`:
  - No-fit: add row to Closed/Rejected section: `| YYYY-MM-DD | <Company> | <Role> | <profile_slug> | SearchAPI | Closed | No fit — <reason> | — | — |`
  - Fit: add row to Active Applications: `| YYYY-MM-DD | <Company> | <Role> | <profile_slug> | SearchAPI | Pending Review | Found via search — pending review[<⚠️ flag(s) if any>] | Review JD | — |`

**Output one line:**
- Fit: `+ <Company> — <Role> → applications/<folder>/`
- No-fit: `- <Company> — <Role> [no fit — score N/10]`

Increment `fit_count` (fit) or `no_fit_count` (no-fit).

Delete the batch file now that all processing is complete:
```bash
rm -f "$batch_file"
```

**Step 4 — Write summary file and log to CSV**

`run_timestamp` was captured in Step 2; format it as `YYYY-MM-DD-HHMMSS` (e.g. `2026-05-08-100703`) for use in filenames.
Derive `summary_filename = <run_timestamp>-<profile>-summary.md`.
`search_query` for logging = all sub-queries joined with ` | ` (e.g. `"Solutions Engineer" OR ... | "Solutions Architect" OR ...`).

4a. Write the summary file:
- **OB1_MODE=true:** `upload_file('search/<summary_filename>', <summary_content>, 'text/markdown')`
- **OB1_MODE=false:** Write to `$APPLICANT_DIR/search/<summary_filename>`

Summary content:
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
**No fit:** <no_fit_count>
**Fetch failed:** <fetch_failed_count>
**Closed (job no longer available):** <closed_count>

## Sub-queries
<numbered list of all sub_queries for this profile — all are always run>

## Fit Jobs (score >= 7)

| Company | Role | Location | Score | Folder |
|---------|------|----------|-------|--------|
<one row per fit job>

_No fit jobs found._ (use this line only if fit_count == 0, instead of the table)

## No-Fit Jobs

| Company | Role | Location | Score | Reason |
|---------|------|----------|-------|--------|
<one row per no-fit job>

## Failed to Fetch

| Company | Role | Location | Reason |
|---------|------|----------|--------|
<one row per job in fetch_failed_jobs>

_No fetch failures._ (use only if fetch_failed_count == 0, instead of the table)
```

4b-ob1. **OB1 search run log** (OB1_MODE=true only):
Call `log_search_run(profile_slug=<profile>, query=<search_query>, pages_fetched=<pages_fetched>, total_results=<total_results>, new_after_dedup=<new_after_dedup>, screened=<screened>, fit_count=<fit_count>, summary_key='search/<summary_filename>')`.

4b. **Local search run log** (OB1_MODE=false only):
Append one row to `$APPLICANT_DIR/search/search-log.csv`. Create the file with header if it does not exist:
```
date,time,profile,pages_fetched,total_results,new_after_dedup,screened,fit_count,fetch_failed,query,summary_file
```
Row values: today's date (YYYY-MM-DD), current time (HH:MM:SS), profile slug, final counter values, `search_query` (CSV-quoted: wrap in `"`, escape any internal `"` as `""`), and `summary_filename`.

**Step 5 — Report**

Output:
```
Ingestion complete — <profile>
  Sub-queries run:   <number run>
  Pages fetched:     <pages_fetched>
  Jobs returned:     <total_results>
  New (deduped):     <new_after_dedup>
  Screened:          <screened>
  Fit:               <fit_count>
  No fit:            <no_fit_count>
  Fetch failed:      <fetch_failed_count>
  Closed (skipped):  <closed_count>
  Summary: search/<summary_filename> (OB1) / $APPLICANT_DIR/search/<summary_filename> (local)
  Log: js_search_runs via log_search_run() (OB1) / $APPLICANT_DIR/search/search-log.csv (local)
```
If fit_count < SEARCH_TARGET_FITS: add note "Results exhausted — fewer than target fits found."

---

RULES
- Do not auto-generate resumes. Fit jobs are saved as stubs for the applicant to review.
- Try WebFetch first on each apply URL before falling back to fetch-jd.py — per Automated JD Workflow Step 1. Check for login-wall signals in the WebFetch response before accepting it.
- search-result.json is written for every job that gets a folder (fit, no-fit, and fetch-failed).
- Do not skip the deduplication check — the script handles it via seen-jobs.json; pass the page_token correctly and always pass --query so each sub-query's results are attributed correctly.
- Do not fabricate company, role, or location data — use only what the search result and fetched JD contain.
- If SEARCHAPI_KEY is not set in .env, tell the user to add it and stop.
- The `$PLAYWRIGHT_PYTHON` interpreter has the required dependencies (requests, etc.). Use it to run the script.
- Always pass `--query "<current_query>"` to the script — never rely on the script's table-lookup when running from /ingest, since the table now has multiple rows per profile.
