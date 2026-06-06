Fetch LinkedIn job recommendations and save fit jobs as application stubs for review.

USAGE
    /linkedin-ingest                      — fetch up to 4 pages (default)
    /linkedin-ingest --max-pages N        — cap at N pages (pass 0 for unlimited)

---

EXECUTION STEPS — run in order without asking for confirmation

**Step 1 — Load context**
- Read `$APP_DIR/.env`, resolve `$APP_DIR`, `$APPLICANT_DIR`, `PLAYWRIGHT_PYTHON`
- Read `DATA_BACKEND` from `.env` (default: `local`). Set `OB1_MODE = (DATA_BACKEND == "ob1")`. When OB1_MODE=true, all applicant file reads and writes must use OB1 MCP tools (`get_file`, `upload_file`, `create_application`, etc.) — direct `$APPLICANT_DIR` operations are forbidden. OB1 MCP availability was verified at session start — do not re-check here.
- Parse invocation arguments: if `--max-pages N` was provided, pass it to the fetch script.
- Load `applicant.md` for location/comp hard-stops:
  - OB1: `get_file('applicant.md')`
  - Local: read `$APPLICANT_DIR/applicant.md`
- Load `PROFILES-QUICK-REFERENCE.md` for all active profiles and the `## Hard Stops` / `## Location Check` sections:
  - OB1: `get_file('profiles/PROFILES-QUICK-REFERENCE.md')`
  - Local: read `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
- Extract ALL profile slugs from the profiles table in PROFILES-QUICK-REFERENCE.md (one slug per row). These are used as candidate profile matches during Haiku screening.

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
tmp_recs_file = /tmp/linkedin-recs-<run_timestamp>.json
```

**Step 3 — Fetch LinkedIn recommendations**

Run the scraper:
```bash
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-linkedin-recs.py" [--max-pages N] --out "$tmp_recs_file"
```

- **Exit code 2** (auth expired): tell the user to re-authenticate:
  ```
  python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'
  ```
  Then stop — do not proceed.
- **Exit code 1** (error): report the error and stop.
- **Exit code 0**: parse `$tmp_recs_file` as JSON. Set:
  - `pages_fetched = result.pages_fetched`
  - `total_results = result.total`
  - `raw_jobs = result.jobs`  (array of job objects)

If `raw_jobs` is empty: output "No jobs returned from LinkedIn recommendations." and stop.

**Step 4 — Deduplicate**

Load (or create if missing) the LinkedIn seen-jobs file — a flat JSON object `{ "job_ids": [...] }`:
- OB1: `get_file('search/linkedin-seen-jobs.json')` — if tool returns "not found" / 404, treat as `{ "job_ids": [] }`
- Local: read `$APPLICANT_DIR/search/linkedin-seen-jobs.json` — if missing, treat as `{ "job_ids": [] }`

Filter `raw_jobs` to only those with `job_id` NOT in `seen_ids`. These are `new_jobs`.
`new_after_dedup = len(new_jobs)`

Append ALL fetched `job_id` values (new + already-seen) to the `job_ids` array. Deduplicate and sort alphabetically. Save:
- OB1: `upload_file('search/linkedin-seen-jobs.json', <updated_json>, 'application/json')`
- Local: write to `$APPLICANT_DIR/search/linkedin-seen-jobs.json`

If `new_after_dedup == 0`: output "No new jobs after deduplication (all previously seen)." and proceed to Step 6 (skip Step 5).

**Step 5 — Fetch full JDs + screen + create stubs**

Before entering the loop, extract from the files loaded in Step 1 (reuse across all jobs):
- From `applicant.md`: the "Location" section, "Deal-breakers (Hard No)" section, the "Not interested in" subsection from "Role Preferences", and compensation/target salary line only
- From `PROFILES-QUICK-REFERENCE.md`: the `## Hard Stops` section, `## Location Check` section, and the profile overview table (profile slugs + one-line summaries)

Read `new_jobs` and **for each job object**:

**5a. Apply link:**
- Use `job.apply_link` (already a canonical LinkedIn job view URL)
- If missing: `fetch_result = "no_url"`, `full_jd_content = null` — jump to **5c (Failure)**

**5b. Attempt to fetch the full JD:**

For the `apply_link`:
- **Try WebFetch first:** if response title or body contains login-wall signals ("sign in", "log in", "authwall", "join now", "join to see", "please sign in", "sign in to view", "create an account") or URL contains auth path segments: treat as auth-walled, skip WebFetch, fall through.
- **If WebFetch succeeded with real content:** `fetch_result = "success"`, `full_jd_content = <response body>` — proceed to 5d.
- **Fall back to fetch-jd.py:**
  ```bash
  "$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out - "<apply_link>"
  ```
  - Exit 0: `fetch_result = "success"`, `full_jd_content = stdout` — proceed to 5d
  - Exit 2: `fetch_result = "auth_required"` — jump to **5c (Failure)**
  - Exit 3: job closed — do NOT create a folder; output: `- <Company> — <Role> [skipped — job closed]`; increment `closed_count`; continue to next job
  - Exit 1 or other: `fetch_result = "failed"` — jump to **5c (Failure)**

**5c. Failure handling** (when `full_jd_content == null`):
- Derive folder slug: use `job.company` and `job.title` if non-empty (slugify: lowercase, spaces → hyphens, strip special chars). If both are empty (scraper only returned a job ID), use `YYYY-MM-DD-linkedin-<job_id>` as the folder slug.

`notes_content`:
```markdown
# Notes — <Company> — <Job Title>

**Status:** Pending Review
**Status Detail:** Fetch failed — <fetch_result> — full JD not available
**Source:** LinkedIn Recommendations
**Date found:** YYYY-MM-DD
**LinkedIn job ID:** <job_id>
**LinkedIn URL:** <apply_link>

## Search Snippet

_No full JD available — fetch failed (<fetch_result>). Visit <apply_link> to review manually._

## Next Steps
- [ ] Visit LinkedIn listing manually and paste JD to continue processing
```

`jd_fallback_content`:
```markdown
**Source:** LinkedIn Recommendations — fetch failed (<fetch_result>)
**Date:** YYYY-MM-DD
**LinkedIn job ID:** <job_id>

---

# <job.title> — <job.company>

| Field | Value |
|---|---|
| Company | <job.company> |
| Location | <job.location> |
| Posted | <job.posted_at or "Not listed"> |
| LinkedIn URL | <apply_link> |
```

**If OB1_MODE=true:**
- `upload_file('applications/<folder>/search-result.json', <json.dumps(job.raw, indent=2)>, 'application/json')`
- `upload_file('applications/<folder>/notes.md', <notes_content>, 'text/markdown')`
- `upload_file('applications/<folder>/jd-<company>-<role>.md', <jd_fallback_content>, 'text/markdown')`
- `upsert_company(name=<company>, slug=<company-slug>)`
- `create_application(company_name=<company>, role_title=<job.title>, folder_prefix='applications/<folder>/', profile_slug='linkedin', source_url=<apply_link>, status='pending-review', status_detail='Fetch failed — <fetch_result>')`

**If OB1_MODE=false:**
- Create `$APPLICANT_DIR/applications/<folder>/`
- Write `search-result.json`, `notes.md`, `jd-<company>-<role>.md`
- Update `$APPLICANT_DIR/application-tracker.md`: add row to Active Applications:
  `| YYYY-MM-DD | <Company> | <Job Title> | linkedin | LinkedIn Recs | Pending Review | Fetch failed — <reason> | Review JD | — |`

- Increment `fetch_failed_count`; append `{company, title, location: job.location, reason: fetch_result}` to `fetch_failed_jobs`
- Output: `! <Company> — <Job Title> [fetch failed — <fetch_result>]`
- Continue to next job

**5d. Screen on real JD** (when `full_jd_content != null`):

Increment `screened`.

Spawn a **Haiku agent** for this single job with:
- The full `full_jd_content` text
- Pre-extracted criteria from Step 5 preamble (location/hard-stops/comp from applicant.md, Hard Stops + all profile slugs/summaries from PROFILES-QUICK-REFERENCE.md)
- Instruction: return a single JSON object. Apply Hard Stops first — any Hard Stop hit = no-fit. Return `fit=true` only if `score >= 7` and no Hard Stop applies. Include `profile_match` — the single best-matching profile slug from the list provided.

  ```
  fit               — true/false
  profile_score     — 1–10
  profile_match     — best matching profile slug from the active profiles list
  employment_type   — "Full-time" / "Contract" / "Part-time" / "Not listed"
  seniority         — level as written in JD, or inferred, or "Not listed"
  travel            — travel requirement as stated, or "Not listed"
  compensation      — comp range as stated, or "Not listed"
  role_summary      — 2–3 sentence paragraph: what the role does and who it serves
  responsibilities  — array of ALL distinct responsibilities stated in the JD (not a sample)
  must_have         — array of {text, gap} objects for ALL must-have/required qualifications; gap=true if applicant has a clear deficiency
  preferred         — array of ALL preferred/nice-to-have qualifications (omit if none)
  fit_reasoning     — narrative paragraph explaining fit or no-fit
  coverage          — for fit=true only: array of {requirement, status} where status ∈ ["✅ Strong", "⚠️ Partial", "❌ Gap"]; 3–8 key requirements
  ```

**5e. Create application folder and write files:**
- Derive folder slug: `YYYY-MM-DD-<company-slug>-<role-slug>` (today's date). Use the company name and role title extracted from the **full JD** (as determined by Haiku) — `job.company` / `job.title` from the scraper are empty because field data is intentionally not extracted from the recommendation page. Fall back to `job.company` / `job.title` only if they happen to be non-empty.
- Use `profile_match` from Haiku as the profile slug for this application

**`job-description.md`** content:
```markdown
# <Company> — <Job Title>

**Profile match:** <profile_match> (score: N/10)
**Source:** LinkedIn Recommendations
**Apply link:** <apply_link>
**Status:** <Pending Review (fit) | Closed (no-fit)>
**Status Detail:** <Found via LinkedIn — pending review | No fit — [reason]>
**Date found:** YYYY-MM-DD
**LinkedIn job ID:** <job_id>

---

## Key Info

| Field | Value |
|---|---|
| Company | <company — use full JD value if more specific> |
| Role | <job.title> |
| Location | <location> |
| Employment Type | <employment_type from Haiku> |
| Seniority | <seniority from Haiku> |
| Compensation | <compensation from full JD if available, else Haiku> |
| Travel | <travel from full JD if available, else Haiku> |
| Posted | <job.posted_at or "Not listed"> |

---

## Company Overview

<Extract 2–4 sentences from full JD about what the company does, industry, and customer base.
Omit this section if the full JD contains no company description.>

---

## Role Summary

<role_summary from Haiku>

---

## Key Responsibilities

<Extract ALL distinct responsibilities from the full JD as bullets. Preserve subheadings if present.>

---

## Requirements

### Must Have
- <requirement text> [append "⚠️ GAP" if Haiku flagged gap=true]
<Omit section if no required qualifications stated.>

### Preferred / Nice-to-Have
- <preferred requirement>
<Omit section if none stated.>

---

## Benefits

- <benefit bullet>
<Omit section if none listed.>

---

## Fit Assessment

**Profile**: <profile_match>
**Score**: N/10

<fit_reasoning from Haiku>

---

## Coverage Assessment

| Requirement | Coverage |
|---|---|
| <requirement> | <✅ Strong / ⚠️ Partial / ❌ Gap> |
(omit entire section if no-fit or coverage array empty)
```

**`jd-<company>-<role>.md`** content:
Full verbatim markdown of the fetched JD, prepended with:
```
**Source:** <apply_link> (fetched via <"WebFetch" | "fetch-jd.py --md-out">)
**Date fetched:** YYYY-MM-DD
**LinkedIn job ID:** <job_id>

---

```
Then append `full_jd_content` character-for-character.

**`search-result.json`** content: `json.dumps(job.raw, indent=2)` — the raw object from `fetch-linkedin-recs.py` output for this job. Do NOT reconstruct or omit fields.

**`notes.md`** content:

For **no-fit** jobs:
```markdown
# Notes — <Company> — <Job Title>

**Status:** Closed
**Status Detail:** No fit — <brief reason>
**Source:** LinkedIn Recommendations
**Date found:** YYYY-MM-DD
**Profile match:** <profile_match> (score: N/10)
**LinkedIn job ID:** <job_id>

## Fit Assessment
<fit_reasoning from Haiku>
```

For **fit** jobs:
```markdown
# Notes — <Company> — <Job Title>

**Status:** Pending Review
**Status Detail:** Found via LinkedIn — pending review
**Source:** LinkedIn Recommendations
**Date found:** YYYY-MM-DD
**Profile match:** <profile_match> (score: N/10)
**LinkedIn job ID:** <job_id>

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
- `upload_file('applications/<folder>/jd-<company>-<role>.md', <content>, 'text/markdown')`
- `upload_file('applications/<folder>/search-result.json', <content>, 'application/json')`
- `upload_file('applications/<folder>/notes.md', <content>, 'text/markdown')`
- `upsert_company(name=<company>, slug=<company-slug>)`
- `create_application(company_name=<company>, role_title=<job.title>, folder_prefix='applications/<folder>/', profile_slug=<profile_match>, source_url=<apply_link>, status=<'pending-review' (fit) | 'closed' (no-fit)>, status_detail=<'Found via LinkedIn — pending review' | 'No fit — <brief reason>'>)`

**If OB1_MODE=false** — write to disk and update tracker:
- Create `$APPLICANT_DIR/applications/<folder>/`
- Write all four files
- Update `$APPLICANT_DIR/application-tracker.md`:
  - No-fit: add row to Closed/Rejected: `| YYYY-MM-DD | <Company> | <Job Title> | <profile_match> | LinkedIn Recs | Closed | No fit — <reason> | — | — |`
  - Fit: add row to Active Applications: `| YYYY-MM-DD | <Company> | <Job Title> | <profile_match> | LinkedIn Recs | Pending Review | Found via LinkedIn — pending review | Review JD | — |`

**Output one line per job:**
- Fit: `+ <Company> — <Job Title> → applications/<folder>/`
- No-fit: `- <Company> — <Job Title> [no fit — score N/10]`

Increment `fit_count` (fit) or `no_fit_count` (no-fit).

Delete the tmp file when all jobs are processed:
```bash
rm -f "$tmp_recs_file"
```

**Step 6 — Write summary file and log**

`run_timestamp` was captured in Step 2; format as `YYYY-MM-DD-HHMMSS` for filenames.
Derive `summary_filename = <run_timestamp>-linkedin-recommended-summary.md`.

6a. Write the summary file:
- **OB1_MODE=true:** `upload_file('search/<summary_filename>', <summary_content>, 'text/markdown')`
- **OB1_MODE=false:** Write to `$APPLICANT_DIR/search/<summary_filename>` (create `search/` if missing)

Summary content:
```markdown
# Search Summary — LinkedIn Recommendations — YYYY-MM-DD HH:MM:SS

**Source:** LinkedIn Recommendations
**URL:** https://www.linkedin.com/jobs/collections/recommended
**Date:** YYYY-MM-DD HH:MM:SS
**Pages fetched:** <pages_fetched>
**Total returned:** <total_results>
**New (deduped):** <new_after_dedup>
**Screened:** <screened>
**Fit:** <fit_count>
**No fit:** <no_fit_count>
**Fetch failed:** <fetch_failed_count>
**Closed (skipped):** <closed_count>

## Fit Jobs (score >= 7)

| Company | Role | Location | Score | Profile | Folder |
|---------|------|----------|-------|---------|--------|
<one row per fit job>

_No fit jobs found._ (use only if fit_count == 0)

## No-Fit Jobs

| Company | Role | Location | Score | Reason |
|---------|------|----------|-------|--------|
<one row per no-fit job>

## Failed to Fetch

| Company | Role | Location | Reason |
|---------|------|----------|--------|
<one row per job in fetch_failed_jobs>

_No fetch failures._ (use only if fetch_failed_count == 0)
```

6b. **OB1 search run log** (OB1_MODE=true only):
```
log_search_run(
  profile_slug="linkedin-recommended",
  query="https://www.linkedin.com/jobs/collections/recommended",
  pages_fetched=<pages_fetched>,
  total_results=<total_results>,
  new_after_dedup=<new_after_dedup>,
  screened=<screened>,
  fit_count=<fit_count>,
  summary_key='search/<summary_filename>'
)
```

6c. **Local search run log** (OB1_MODE=false only):
Append one row to `$APPLICANT_DIR/search/search-log.csv`. Create file with header if missing:
```
date,time,profile,pages_fetched,total_results,new_after_dedup,screened,fit_count,fetch_failed,query,summary_file
```
Row: today's date, current time, `linkedin-recommended`, final counter values, `"https://www.linkedin.com/jobs/collections/recommended"`, `summary_filename`.

**Step 7 — Report**

```
LinkedIn ingestion complete
  Pages fetched:     <pages_fetched>
  Jobs returned:     <total_results>
  New (deduped):     <new_after_dedup>
  Screened:          <screened>
  Fit:               <fit_count>
  No fit:            <no_fit_count>
  Fetch failed:      <fetch_failed_count>
  Closed (skipped):  <closed_count>
  Summary: search/<summary_filename>
```

---

RULES
- Do not auto-generate resumes. Fit jobs are saved as stubs for the applicant to review.
- Try WebFetch before fetch-jd.py on each apply_link — LinkedIn job pages require auth, so WebFetch will usually fail with a login wall; fall through immediately to fetch-jd.py.
- search-result.json is written for every job that gets a folder (fit, no-fit, and fetch-failed).
- Do not fabricate company, role, or location data — use only what fetch-linkedin-recs.py returned and the fetched JD contain.
- If PLAYWRIGHT_PYTHON is not set in .env, tell the user and stop.
- The `$PLAYWRIGHT_PYTHON` interpreter has the required dependencies. Always use it (not system python3) to run the scripts.
- Auth refresh: if exit code 2 at any point, stop and tell the user: `python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'`
