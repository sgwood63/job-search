---
name: process-jd
description: Core JD processing module — screen (with KG context lookup), create folder, compose files, save (parallel OB1 uploads), register in tracker, capture OB1 thoughts (parallel), write knowledge graph edges (parallel).
---

# process-jd Workflow (draft)

Canonical single source for everything that happens after a JD is fetched. Called by `create-application`, `search-jobs`, and `search-jobs-linkedin`. All callers pass pre-fetched `jd_content` — this workflow never fetches URLs.

All file access follows the storage-routing policy (`DATA_BACKEND` env var).

**Changes from v4:**
- Step 1: Screening context block is now explicit — the caller constructs a verbatim prompt block from `## Location Check` and `## Hard Stops` sections of `PROFILES-QUICK-REFERENCE.md` (pre-loaded by the caller). Output contract reference updated to `skills/jd-evaluation/draft.md` (19-field contract including `location_extracted`, `location_verdict`). `location_extracted` and `location_verdict` added to the `Set:` line.
- New Step 2.5 (fit jobs only): 1–2 WebSearches before composing `job-description.md`. Search results feed a new combined section `## Company & Market Context` (replaces `## Company Overview`) and the **Role type** line in `## Role Summary`. No-fit jobs get the original thin 2–4 sentence overview — no search for jobs that don't pass screening.
- `## Company Overview` renamed to `## Company & Market Context`: four-part structure — business overview, Division/Team, Products/Platform (with links), and a 150–250 word **Market & Strategic Context** narrative (why this company/space matters now, competitive dynamics, strategic direction). Both the structured reference and market analysis are in one section, available at Pending Review without opening notes.md.
- `## Role Summary` rule: add **Role type** line — classify as BVC/value engineering, traditional SE, implementation consultant, etc., with 1–2 closest analogs.
- `company_research` OB1 thought eliminated from `create-application` — company context now fully covered here.

---

## Inputs

| Name | Required | Description |
|---|---|---|
| `jd_content` | Yes | **Raw, unmodified JD text as extracted from the source page** — do NOT summarize, reformat, or paraphrase before passing. Must be character-for-character what the fetch script or source API returned, minus UI chrome (navigation, sidebar, footer). Verbatim rule is enforced end-to-end: if the caller preprocesses jd_content, the jd-*.md file will be wrong. |
| `source_url` | Yes | Apply URL or canonical source reference |
| `source_name` | Yes | Human-readable source, e.g. `"SearchAPI / Google Jobs — /ingest presales-se"`, `"LinkedIn Recommendations"`, `"Manual"` |
| `profile_hint` | No | Caller's best-guess profile slug; jd-evaluation may override |
| `source_metadata` | No | Optional dict: `{via?, posted_at?, job_id?, raw_source_json?}` |

## Step 0 — KG Context Lookup (OB1 only)

Skip in local mode. If `jd_content` contains a clear company name, extract it with a minimal pass (do not spawn Haiku yet).

Call `get_entity_neighbors(entity_name=<company_name>, entity_type='organization', direction='both')`.

Build `kg_context` from the result:
- `prior_requirements`: `to_entity_name` values where `relation='requires'`
- `existing_applications`: `{role, status}` for edges where `relation='applied_to'` or `relation='interviewed_at'`
- `known_contacts`: `from_entity_name` values where `relation='member_of'`

If `get_entity_neighbors` returns empty or errors: set `kg_context = {}` and continue — never block on this step.

## Step 1 — Screen via jd-evaluation

Spawn a **Haiku agent** and follow `$APP_DIR/skills/jd-evaluation/draft.md` for the full extraction, location check, fit check, and output contract.

**Construct the screening context block verbatim and include it in the Haiku prompt:**

```
**Location Check (from PROFILES-QUICK-REFERENCE.md ## Location Check):**
<verbatim content of ## Location Check section>

**Hard Stops (from PROFILES-QUICK-REFERENCE.md ## Hard Stops):**
<verbatim content of ## Hard Stops section>

**Compensation floor:** <extracted from applicant.md>
```

The caller must have pre-loaded these sections from `PROFILES-QUICK-REFERENCE.md`. Pass them verbatim into the Haiku prompt — do not summarize or paraphrase. This allows Haiku to classify location correctly against the actual applicant criteria without this workflow hardcoding any location names.

Also include in the Haiku prompt:
- The full `jd_content` text
- `profile_hint` if provided
- Profile slugs and one-line summaries from `PROFILES-QUICK-REFERENCE.md`
- `kg_context` (OB1 only): if non-empty, include the following section:

  ```
  **Known context for <company_name> from prior sessions:**
  - Prior skill signals: <prior_requirements joined with ", ", or "none">
  - Existing applications: <existing_applications as "Role (Status)" list, or "none">
  - Known contacts: <known_contacts joined with ", ", or "none">

  Use this context to inform fit_reasoning and gap detection. If an existing application
  exists with status 'applied' or later, flag it in fit_reasoning as a potential duplicate.
  ```

Instruction to Haiku: return the full 19-field JSON object defined in `skills/jd-evaluation/draft.md ## Output contract`.

Apply Hard Stops first — any Hard Stop hit = no-fit regardless of score. Return `fit=true` only if `profile_score >= 7` and no Hard Stop applies.

Set: `verdict = screening.fit`, `score = screening.profile_score`, `profile_match = screening.profile_match`, `location_extracted = screening.location_extracted`, `location_verdict = screening.location_verdict`.

## Step 2 — Derive Folder Slug

`folder_slug = YYYY-MM-DD-<company-slug>-<role-slug>`

Rules: today's date; company and role from the JD content (Haiku extracts them); lowercase; spaces → hyphens; strip special characters.

## Step 2.5 — Web Search Company Context (fit jobs only)

**Skip entirely for no-fit jobs.** No search, no delay — proceed directly to Step 3 with `company_web_context = null`.

For fit jobs, run **1–2 WebSearches** (not WebFetch — web search aggregates multiple sources and returns reference links for verification):

**Search 1 — product portfolio:**
Query: `"<Company Name>" products portfolio divisions 2025`
Goal: Identify all major product families or solution categories, with URLs returned in results.

**Search 2 — team/function context** (run if Search 1 doesn't surface the relevant division or team type):
Query: `"<Company Name>" "<team name from JD, e.g. Business Value Consulting>" OR "<role function keyword, e.g. value engineering, presales>" enterprise 2025`
Goal: Confirm which team owns this role and what that team does; surface any official team pages or org descriptions.

**No domain restriction** — broader searches return richer results. Do not restrict to `site:company.com`.

Collect from both searches:
- All product families/categories found, with their URLs from search results
- Division or team context relevant to the role
- Company overview data (scale, revenue, funding stage, HQ, customer base)
- Market dynamics: what's driving investment in this space, key buyer trends, competitive landscape
- Recent strategic initiatives, product direction, or notable news
- All reference URLs returned — included verbatim in the Sources footer

Store combined result as `company_web_context`.

**If WebSearch is unavailable or returns no useful results:** set `company_web_context = null` and note in Step 3.

## Step 3 — Compose File Contents

Compose all file contents before writing (so OB1 vs local branching in Step 4 is clean).

### `job-description.md`

```markdown
# <Company> — <Role Title>

**Profile match:** <profile_match> (score: N/10)
**Source:** <source_name>
**Apply link:** <source_url>
**Status:** <Pending Review (fit) | Closed (no-fit)>
**Status Detail:** <source-appropriate status detail — see notes below>
**Date:** YYYY-MM-DD
[**Via:** <source_metadata.via>]            ← include only if source_metadata.via present
[**LinkedIn job ID:** <source_metadata.job_id>]  ← include only if source_metadata.job_id present
[**Posted:** <source_metadata.posted_at>]   ← include only if source_metadata.posted_at present

---

## Key Info

| Field | Value |
|---|---|
| Company | <company — use full JD value; fall back to search result if JD lacks it> |
| Role | <role title> |
| Location | <location> |
| Employment Type | <employment_type from Haiku> |
| Seniority | <seniority from Haiku> |
| Compensation | <compensation from full JD if available, else Haiku> |
| Travel | <travel from full JD if available, else Haiku> |

---

## Company & Market Context

<For **no-fit** jobs: extract 2–4 sentences from full JD about what the company does, industry, and customer base. If posted via a recruiting agency, note the likely employer and confidence level. Omit this section if the full JD contains no company description.>

<For **fit** jobs — use JD text + company_web_context. Four-part structure:>

**[business overview]**
<2–3 sentences: who the company is — what they do, industry, scale (employees, revenue or funding stage), HQ, customer base. Source from JD text first; supplement with search results if richer.>

**Division / Team:** <Which business unit, product group, or team owns this role. State directly if named in JD. If not named in JD but inferable from search results + role context, state with a brief basis. If not determinable, omit this line.>

**Products / Platform:**
- [Product or product family name](link) — <1-line description of what it does>
- [Product or product family name](link) — <1-line description>
...

**Market & Strategic Context:**
<150–250 word narrative sourced from search results: What market is this company operating in and why does it matter right now? Cover: key market dynamics and buyer trends driving investment in this space; what makes this company's approach distinctive or differentiated; recent strategic initiatives, direction, or news; competitive landscape context. Source strictly from search result content — do not fill gaps from model knowledge. If market context is sparse in search results, write less; do not pad with generic industry observations.>

<Rules:>
- Product links must come from search result URLs — do not construct URLs from model knowledge
- Any claim not corroborated by a search result: append [UNVERIFIED — confirm before use]
- If company_web_context is null: omit Division/Team, Products/Platform, and Market & Strategic Context; use 2–4 sentences from JD only
- Close the section with a Sources blockquote listing all reference URLs from search results:
  `> Sources: [Label](url) · [Label](url) · ...`
  Omit if company_web_context is null.

---

## Role Summary

<role_summary from Haiku — 2–3 sentences: what the role does and who it serves.
If Haiku's summary is thin (under 2 sentences), re-extract from the full JD.>

**Role type:** <1–2 sentence classification using the JD's emphasis signals:
- Heavy ROI modeling, business case development, executive alignment, deal support → "Value Engineering / Business Value Consulting role" — name 1–2 closest analogs (e.g., Value Engineering at Salesforce, Business Value Services at Databricks, Economic Value Consulting at IBM)
- Product demos, PoCs, technical validation, quota-bearing → "Solutions Engineer / Sales Engineer role"
- Deployment, configuration, change management, post-sale → "Implementation / Professional Services role"
- Post-sale adoption, renewals, expansion → "Customer Success / Technical Account Management role"
- Mixed pre/post sales architecture, no quota → "Technical Solutions Architect / Advisory role"
If the role clearly spans two types, name both.>

---

## Key Responsibilities

<Extract ALL distinct responsibilities from the full JD as bullets.
If the JD groups them by subsection, preserve those subheadings.
Do not limit — include every distinct responsibility stated.>

---

## Requirements

### Must Have
- <requirement text> [append "⚠️ GAP" if Haiku flagged gap=true for a matching requirement]
<Use the full requirements list from the fetched JD. Overlay Haiku's gap flags.
Omit section if no required qualifications are stated.>

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
(one row per coverage item from Haiku; omit entire section if no-fit or coverage array empty)
```

**Status Detail wording by source and verdict:**
- SearchAPI fit: `Found via search — pending review` (append `⚠️ <flag>` for any Haiku gap=true items)
- SearchAPI no-fit: `No fit — <brief reason>`
- LinkedIn fit: `Found via LinkedIn — pending review`
- LinkedIn no-fit: `No fit — <brief reason>`
- Manual: `Pending review` (fit) / `No fit — <brief reason>` (no-fit)

### `jd-<company>-<role>.md`

> **HARD RULE:** Write `jd_content` VERBATIM — character-for-character. Do NOT summarize, extract, reformat, or paraphrase any part of it. No bullets, no headers, no edits. This is the archival raw source; `job-description.md` is the structured extraction. They are different files serving different purposes. Treat this like copying binary content.

Prepend with:
```
**Source:** <source_url> (fetched by caller)
**Date fetched:** YYYY-MM-DD
[**LinkedIn job ID:** <source_metadata.job_id>]  ← include only if present

---

```
Then append `jd_content` character-for-character.

### `search-result.json` (only if `source_metadata.raw_source_json` provided)

Write the exact, verbatim content of `source_metadata.raw_source_json` — the original search result object with ALL fields intact. Copy character-for-character. Do NOT reconstruct, summarize, or omit any fields. This is the only archival record of what the API returned for this job.

### `notes-index.md` (replaces `notes.md` stub from v1)

For **no-fit** jobs:
```markdown
# Notes Index — <Company> — <Role Title>

**Status:** Closed
**Status Detail:** No fit — <brief reason>
**Date:** YYYY-MM-DD
**Profile:** <profile_match> (score: N/10)
**Source:** <source_name>
**Source URL:** <source_url>

## OB1 Thought Keys

- fit_assessment: <to be populated in Step 5>
```

For **fit** jobs:
```markdown
# Notes Index — <Company> — <Role Title>

**Status:** Pending Review
**Status Detail:** <status detail — same wording as job-description.md>
**Date:** YYYY-MM-DD
**Profile:** <profile_match> (score: N/10)
**Source:** <source_name>
**Source URL:** <source_url>
[**LinkedIn job ID:** <source_metadata.job_id>]  ← include only if present

## OB1 Thought Keys

- jd_analysis: <to be populated in Step 5>
- fit_assessment: <to be populated in Step 5>
```

The `## OB1 Thought Keys` section is updated in Step 5 once thought IDs are known.

**Local mode:** Create `notes.md` instead of `notes-index.md` using the v1 stub format (no thought capture in local mode).

## Step 4 — Save Files

Save all composed files per storage-routing:

**OB1 active** (`DATA_BACKEND=ob1`):
1. `upsert_company(name=<company>, slug=<company-slug>)` — pass **only** `name` and `slug`; do not pass `company_stage`, `size`, `funding`, or other optional fields (the model cannot reliably infer these from JD text and the schema will reject guessed values)
2. `create_application(company_name=<company>, role_title=<role>, folder_prefix='applications/<folder_slug>/', profile_slug=<profile_match>, source_url=<source_url>, status=<'pending-review' (fit) | 'closed' (no-fit)>, status_detail=<status detail text>)` → save UUID as `application_id`
3. **In one parallel turn**, call all of the following (none depend on each other's return values):
   - `upload_file('applications/<folder_slug>/job-description.md', content, 'text/markdown')`
   - `upload_file('applications/<folder_slug>/jd-<company>-<role>.md', content, 'text/markdown')`
   - `upload_file('applications/<folder_slug>/notes-index.md', content, 'text/markdown')`
   - If `raw_source_json` provided: `upload_file('applications/<folder_slug>/search-result.json', content, 'application/json')`
   - `update_application_fields(id=<application_id>, domain_tags=<domain_tags from Haiku screening>, jd_requirements=<jd_requirements_structured from Haiku screening>)`

   `domain_connection` is left null here — it requires Sonnet + applicant profile context. It is populated by `create-application` in Step 4a (fit applications only) after the Domain Connection subsection of notes.md is written.

**Local** (fallback):
1. `mkdir "$APPLICANT_DIR/applications/<folder_slug>/"`
2. Write `job-description.md`, `jd-<company>-<role>.md`, `notes.md` (v1 stub format — no thought capture in local mode)
3. If `raw_source_json` provided: write `search-result.json`
4. `application_id = "$APPLICANT_DIR/applications/<folder_slug>"`

## Step 5 — Capture OB1 Thoughts (OB1 only)

Skip this step in local mode.

**Idempotency check first:** Call `search_thoughts` with filter `{metadata: {application_id, thought_category: "fit_assessment"}}`. If a result is returned, thoughts already exist for this application — skip thought capture and proceed to Step 6.

### Compose and capture thoughts

**jd_analysis thought** (fit jobs only):

Content (200–500 words, NOT verbatim JD):
```
<Company> — <Role Title>

## Role and Company
<role_summary from Haiku. 2–3 sentences on what the role does and who it serves.>

## Key Requirements
<List ALL must_have qualifications from Haiku as bullets (with ⚠️ GAP where flagged).
List preferred qualifications as a secondary bullet group.>

## Signals
<2–3 bullets on domain signals (industry, customer type, tech stack, company stage) that inform positioning.>
```

**fit_assessment thought** (all jobs — fit and no-fit):

Content:
```
<Company> — <Role Title> | Score: N/10 | Verdict: <Fit / No Fit>

<fit_reasoning from Haiku verbatim>

## Coverage
<For fit: coverage table from Haiku as markdown table.>
<For no-fit: "Hard Stops hit: <hard_stops_hit array>" if any, then "Key gaps: <gap reasoning>">
```

**In one parallel turn**, call both thoughts simultaneously:
```
capture_thought(
  content = <composed jd_analysis text>,
  metadata = {
    source_type: "job_search",
    thought_category: "jd_analysis",
    application_id: <application_id>,
    application_folder: <folder_slug>,
    company: <company>,
    profile_slug: <profile_match>
  }
)
→ save returned thought_id as jd_analysis_thought_id
```
```
capture_thought(
  content = <composed fit_assessment text>,
  metadata = {
    source_type: "job_search",
    thought_category: "fit_assessment",
    application_id: <application_id>,
    application_folder: <folder_slug>,
    company: <company>,
    profile_slug: <profile_match>
  }
)
→ save returned thought_id as fit_assessment_thought_id
```

For no-fit jobs: omit the `capture_thought(jd_analysis)` call — call only `capture_thought(fit_assessment)` (no parallelism needed for a single call).

Both IDs are available after the turn completes.

### Update notes-index.md with thought IDs

Re-upload notes-index.md with actual thought IDs replacing the placeholders:
- For fit: replace `<to be populated in Step 5>` for both `jd_analysis` and `fit_assessment`
- For no-fit: replace `<to be populated in Step 5>` for `fit_assessment`

```
upload_file('applications/<folder_slug>/notes-index.md', <updated content>, 'text/markdown')
```

## Step 6 — Knowledge Graph Edges (OB1 only)

**OB1 mode only.** Skip in local mode. Skip if `jd_requirements_structured` is null or `jd_requirements_structured.required` is empty.

**Idempotency check:** Call `get_entity_neighbors(entity_name=<company_name>, entity_type='organization', relation='requires', direction='out')`. If any result has `metadata.application_id` matching the current `application_id` → edges already written for this application; skip this step.

For each requirement in `jd_requirements_structured.required`, **cap at 15 total**, infer entity type:
- Specific named technology, language, framework, platform, tool → `tool`
- Functional skill, behavioral competency, domain knowledge, industry expertise → `topic`

**In one parallel turn**, call ALL `create_knowledge_edge` invocations at once — do not loop serially:

```
create_knowledge_edge(
  from_entity_type = 'organization',
  from_entity_name = <company_name>,
  relation = 'requires',
  to_entity_type = <'tool' | 'topic'>,
  to_entity_name = <requirement text, trimmed to ≤ 60 chars>,
  thought_id = <jd_analysis_thought_id>,   ← omit if no-fit (no jd_analysis thought)
  metadata = {
    application_id: <application_id>,
    source: 'job_search',
    profile_slug: <profile_match>
  }
)
```

Issue all calls (up to 15) as parallel tool calls in a single turn. All calls share the same `thought_id` and `metadata` — only `to_entity_type` and `to_entity_name` vary per requirement.

No output from this step — return from workflow is unchanged.

## Step 7 — Register in Tracker

**OB1**: `create_application()` in Step 4 already handles this.

**Local**: Update `$APPLICANT_DIR/application-tracker.md`:
- No-fit: add row to Closed/Rejected section
- Fit: add row to Active Applications section

Row format: `| YYYY-MM-DD | <Company> | <Role> | <profile_match> | <source abbreviation> | <Status> | <Status Detail> | <Next Action> | — |`

Source abbreviations: `SearchAPI` (Google Jobs), `LinkedIn Recs`, `Manual`.

## Outputs

Return: `{folder_slug, application_id, verdict, score, profile_match}`

Caller is responsible for any post-processing (resume generation, domain connection, notes expansion via `skills/application-summary`, summary writing, progress counting).
