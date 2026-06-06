# Applicant Setup Process

## How to Start

**Prerequisite:** `scripts/setup.sh` must have been run first (creates directories, `.env`, and stub files).

**OB1 note:** If OB1 is active (`DATA_BACKEND=ob1` in `.env`), use `upload_file(key, content, content_type)` **exclusively** for every file created during setup — do not write to `$APPLICANT_DIR` directly. See `memory/feedback_ob1_integration.md` for the canonical routing rule. For the SQL tables (js_applicant, js_profiles, js_experience), use the OB1 MCP state tools or run `python scripts/migrate-to-ob1.py --only-sql` after setup completes to seed the database. If OB1 is not yet deployed, write files to `$APPLICANT_DIR` as normal and run the migration script once OB1 is up.

Open a Claude Code session in the `$APP_DIR` repo directory and say:

> **"Start the applicant setup process"**

Claude will read this file and execute each phase in order, pausing between phases for your input.

---

This document describes how to onboard a new applicant into the job search system. It augments [QUICK-START.md](QUICK-START.md), which covers the technical foundation (directory creation, dependencies, storage setup). Run the technical setup first, then use this process to populate the applicant's data.

---

## Overview

The setup happens in five phases, run as a single Claude chat session, plus an ongoing maintenance phase after setup is complete:

1. **Upload documents** — gather and place source materials in `$APPLICANT_DIR/base-documents/`
2. **Interview the applicant** — draw out demographics and preferences
3. **Generate initial documents** — produce all the files Claude needs to run job applications: experience breakdown, target job profiles, achievements with scores
4. **Provide career advice** — analyze fit and positioning, suggest target roles, identify skill gaps and quick wins
5. **Validate with example JDs** — confirm profiles are right before the live search starts
6. **Maintain profiles** (Phase F, ongoing) — update profile files, achievements, preferences, and career direction as the search progresses

---

## Phase A — Upload Documents

Before the interview, upload source documents to `$APPLICANT_DIR/base-documents/`:

| What | Format | Notes |
|---|---|---|
| Demographic / contact info | Any | Name, location, email, phone, LinkedIn URL, web sites, Git repos |
| Personal profile, experience, achievements | URL | Get from LinkedIn or personal web site, or as documents. store as markdown |
| Existing resumes | PDF or Word | All versions; Claude will extract from them |
| Cover letters (if any) | PDF, Word, HTML | Optional but useful for voice calibration |
| Example JDs (optional) | JD content in PDF, HTML, or document containing URLs | Roles the applicant already has in mind |

For JDs provided as URLs: use `fetch-jd.py --md-out` to save as a markdown file in `base-documents/`. See [README.md](README.md) for setup and usage.

---

## Phase B — Generate Applicant Questionnaire

With base-documents uploaded, generate `$APPLICANT_DIR/applicant.md` as a structured questionnaire:

1. **Read all files in `$APPLICANT_DIR/base-documents/`** — extract contact info, location, domain expertise, and any facts about role history or preferences explicitly stated in the uploaded resumes or LinkedIn profile.

2. **Generate `$APPLICANT_DIR/applicant.md`** using `$APP_DIR/templates/scaffold/applicant.md` as the template:
   - Pre-populate all fields Claude can confidently extract from base-documents (name, contact info, clearly stated domains)
   - Leave `[Fill in: ...]` markers on every required field that needs the applicant's direct input
   - Leave `[Optional: ...]` markers on optional fields the applicant may skip
   - Do not guess preferences — only fill in facts that are explicit in the documents

3. **Tell the applicant:** "I've generated `applicant.md` at `$APPLICANT_DIR/applicant.md` with what I could extract from your documents. Open the file, read each section, fill in your answers, and remove the markers as you go. Optional fields can be left blank or deleted. When you're done, reply **done** to continue to Phase C."

4. **Wait for the done signal.** When the applicant replies "done" (or equivalent), read `$APPLICANT_DIR/applicant.md` and confirm: summarize what is filled in and flag any required `[Fill in: ...]` markers still present. Proceed to Phase C.

**If Phase B is revisited** (applicant.md already exists): Display the current contents of `$APPLICANT_DIR/applicant.md` and ask whether they want to edit it or proceed to Phase C.

---

## Phase C — Generate Initial Documents

After the interview, generate the following files. Do not fabricate — use only what came from the uploaded documents and the interview.

### `$APPLICANT_DIR/applicant.md`
Contact info, location preferences, role preferences, and deal-breakers, goals. This is the file Claude checks on every JD screen.

### `$APPLICANT_DIR/profiles/[profile-name]/[profile-name].md` (one per profile, in its own subdirectory)

Strategy document per role type:
- What makes the applicant strong for this profile
  - score the strength of the applicant for the role, based on their experience
- Framing guidance for experience and accomplishments
- What to emphasize / compress / omit
- Keywords and signals for this audience
- What resume format generally applies for the role? Any special format requirements from the applicant's industry or target companies?
- Where the role is typically posted: like LinkedIn, Indeed, Greenhouse, Lever, Built In, niche boards
  - Search keywords and filters that work best for the profile specific to the posting site

### `$APPLICANT_DIR/profiles/[profile-name]/[profile-name]-CONTENT.md` (one per profile)
Pre-compiled resume content library:
- Opening summaries per profile
- Achievement bullets organized by role, ready to pull from
- Eliminates per-application re-extraction from PDF resumes

### `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
One-row summary per profile for fast JD matching. Claude uses this as the first lookup during screening.

### `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`
Verified fact sheet for every role:
- Exact title, company, and dates
- What the company did (one sentence)
- Specific contributions — not generic job duties
- Technologies and tools actually used
- Verifiable metrics or outcomes: from `role-achievements.md`

Mark any uncertain claims `[UNVERIFIED]`. This is the canonical source of truth — resumes are generated from it, never the reverse.

### `$APPLICANT_DIR/profiles/role-achievements.md` (required)
Canonical achievement set organized by role (most-recent first), scored against all active profiles. Generated during Phase B using the following process:

1. Extract all achievements from uploaded resumes and LinkedIn (de-duplicate across resume versions)
2. For each role, display a table with columns: `# | Achievement | Power | P1 | P2 | … | Pn | Notes`
   (one column per active profile — add or remove columns to match the applicant's profile set)
   - **Power** (1–5): specificity + metrics + named entity + clear outcome
   - **Profile relevance** (1–5): 5 = must include | 3 = situational | 1 = omit
   - **Notes**: scoring rationale and what would improve the achievement
3. After the table, show a **Gaps & prompts** section: what's missing per profile and specific questions to fill those gaps
4. Allow the applicant to edit existing achievements or add new ones before proceeding to the next role
5. After all roles, include an **Achievement Completeness by Profile** summary table

This file replaces per-application resume extraction. All resume generation draws from it.

### Session summary document
Append a session entry to `$APPLICANT_DIR/applicant-maintenance.md` with: date, session type, summary of what was discussed and decided, and files updated. This is the canonical session log.

---

## Phase D — Provide Career Advice

With profiles and the achievement library generated, step back and give the applicant a structured read on their positioning before any applications go out.

### Career Analysis

Present the following as a written analysis saved to `$APPLICANT_DIR/career-advice.md`:

#### 1. Profile Fit Scores

For each profile generated in Phase C, score across four dimensions using a 1–5 scale:

| Profile | Experience Match | Market Demand | Differentiation | Competition Level | Overall |
|---|---|---|---|---|---|

- **Experience Match** (1–5): how well the applicant's background maps to what employers actually ask for in this role
- **Market Demand** (1–5): current hiring volume — how many open roles exist right now vs. the applicant's availability
- **Differentiation** (1–5): how strongly the applicant stands out vs. typical candidates (rare combination, domain depth, track record)
- **Competition Level** (1–5, inverted): 5 = low competition (niche), 1 = highly contested (crowded field)

#### 2. Suggested Target Roles

List 3–5 specific role titles the applicant should actively pursue, beyond the profiles already identified. For each:
- Title and typical seniority band
- Why this role fits (1–2 sentences)
- Which profile it maps to (or note if a new profile is warranted)

#### 3. Skill Gaps

For each profile, identify what the applicant is missing relative to strong candidates:
- Hard gaps (required credentials, tools, or experience the applicant clearly lacks)
- Soft gaps (areas where the applicant's story is thin or hard to defend under scrutiny)
- Note whether each gap is addressable before the search ends (e.g., a certification), or a known risk to manage in interviews

#### 4. Seniority and Trajectory Assessment

- Is the applicant positioned to move up, stay lateral, or does a step-back enable a pivot?
- Flag any roles where the applicant may be perceived as overqualified or underqualified

#### 5. Compensation Expectations

For each profile, provide a rough market range (base salary) the applicant should expect, so they can calibrate their stated floor against reality. Source from publicly available data; note if estimates are uncertain.

#### 6. Quick Win Profile

Identify which profile is most likely to generate interviews in the shortest time given current market conditions, and explain why.

### After the Analysis

Have the applicant review the career-advice.md output. Collect feedback:
- Are any suggested roles surprising — positively or negatively?
- Do the skill gap assessments match the applicant's own sense of their weaknesses?
- Does the quick-win recommendation align with what the applicant actually wants?

Update `$APPLICANT_DIR/profiles` content if the discussion surfaces framing improvements or new profile priorities. Append a session entry to `$APPLICANT_DIR/applicant-maintenance.md` summarising what changed and which files were updated.

---

## Phase E — Profile Validation with Example JDs

Once profiles and career advice are reviewed:

1. **Find example JDs** matching each profile — aim for 2–3 per profile:
   - **With SearchAPI configured** (`SEARCHAPI_KEY` set in `.env`): run `/ingest <profile>` for each profile. This fetches Google Jobs listings, screens them, and saves fit jobs as application stubs. Use those stubs as the validation JDs.
   - **Without SearchAPI**: search LinkedIn, Greenhouse, Lever, or Built In using the keywords identified in Phase C, and paste or fetch JDs manually using `fetch-jd.py --md-out`.
2. **Review for fit** — for each example JD, run the standard screening check against `applicant.md`, noting they are examples
3. **Generate a sample resume** for one well-fitting JD per profile — this stress-tests the content library and surfaces gaps before live applications begin

---

## Phase F — Profile Maintenance

After setup is complete, applicant-level updates are ongoing. Trigger phrases (Claude executes immediately — do not ask):

- "update my preferences" / "change my criteria" / "new deal-breaker"
- "I have a new achievement" / "I finished a project" / "I verified a metric" / "resolved an unverified item"
- "update my experience" / "I have a new role" / "I remembered something about [role]"
- "update my career direction" / "I want to focus on [X]" / "add a new target role"
- "I want to update my profile"

### File Registry

For any maintenance update, consult this registry to determine which files are affected — reason from what changed against what each file contains and who reads it. Do not use a fixed lookup table.

**`applicant.md`**
- Contains: Contact info, job search criteria, preferences, deal-breakers, work style, domain expertise, notes
- Read by: Haiku screening agent on every JD
- Update when: Contact details change; preferences, deal-breakers, or work style shift; domain expertise updated; career direction affects how JDs should be screened

**`profiles/PROFILES-QUICK-REFERENCE.md`**
- Contains: One-row profile summary per profile; scoring rules; hard stops; `## Search Queries` table (one OR-query per profile for `/ingest`)
- Read by: Haiku screening agent for profile selection and fit scoring; `search-jobs.py` for `/ingest` query lookup
- Update when: Profile added or removed; scoring rules change; new JD signals identified; hard stops change; target roles or title focus changes (also update the corresponding `## Search Queries` row); profile removed (also remove its Search Queries row)

**`profiles/[profile]/[profile].md`** (one per profile, in its own subdirectory)
- Contains: Positioning strategy, framing guidance, what to emphasize/compress/omit, target companies, keywords
- Read by: Sonnet during resume generation
- Update when: Positioning or framing changes (e.g., new delivery emphasis); profile added or deprecated; emphasis priorities shift

**`profiles/[profile]/[profile]-CONTENT.md`** (one per profile)
- Contains: Pre-compiled resume bullets by role — factual, sourced content only
- Read by: Sonnet during resume generation (primary bullet source)
- Update when: A role fact changes; a new verified achievement is added; an [UNVERIFIED] claim is resolved; a new role is added
- Do NOT update for framing changes — framing lives in the strategy file, not here

**`profiles/EXPERIENCE-REFERENCE.md`**
- Contains: Verified fact sheet for every role: exact title, company, dates, contributions, technologies, verified metrics
- Read by: Sonnet during resume generation (no-fabrication source of truth)
- Update when: New role added; fact corrected; metric verified or resolved from [UNVERIFIED]; tenure explanation confirmed
- **Role Classification required:** Every new role entry must include a `**Role Classification:**` field — the structural type of the role and any explicit NOT statements for role types that the activity profile could be confused with (e.g., "BD/market development, NOT presales SE"). Claude must ask the user to confirm this field; do not infer it from activity descriptions alone.

**`profiles/role-achievements.md`**
- Contains: Full achievement set scored per profile (Power + profile relevance)
- Read by: Sonnet during resume generation for bullet selection
- Update when: New achievement added; score updated; achievement text refined with verified facts

**`career-advice.md`**
- Contains: Profile fit scores, suggested target roles, skill gaps, seniority assessment, comp ranges, quick win recommendation, feedback log
- Read by: Human (applicant) — not read by the automated workflow
- Update when: Career direction changes affect the strategy recommendations; Feedback Incorporated section only (new target track, rejected recommendation, resolved skill gap)

**`applicant-maintenance.md`**
- Contains: Chronological session log of all setup and maintenance updates
- Read by: Human reference
- Update: Append an entry after every maintenance session

### Cross-Profile Propagation Rule

**When tools, capabilities, or portfolio artifacts are added in a maintenance session:** Step through all profiles' `*-CONTENT.md` files to assess relevance before closing the session. Check whether the new capability or artifact materially strengthens any profile's positioning, existing bullets, or fills a documented gap. If relevant, add to the appropriate `*-CONTENT.md` with source and scoring notes. Record which profiles were reviewed and which received new content in the `applicant-maintenance.md` session entry.

### Operation Checklists

The File Registry and Cross-Profile Propagation Rule cover the general case. Two specific operations require explicit step-by-step checklists because they consistently produce missed updates when reasoned from the registry alone. See `memory/feedback_profile_maintenance.md` for the full checklists.

**Operation A — New Achievement Added** (4 steps: role-achievements.md → EXPERIENCE-REFERENCE.md → cross-profile CONTENT propagation for all active profiles → applicant-maintenance.md log). Do not update career-advice.md §1 Profile Fit Scores for an achievement addition.

**Operation B — New Profile Created** (6 steps + B4.5: create strategy file → create CONTENT file → add profile column to role-achievements.md for all existing achievements → update PROFILES-QUICK-REFERENCE.md matching table row → add Search Queries table row → add profile row and scoring rationale to career-advice.md §1 and §5 → applicant-maintenance.md log). career-advice.md §1 (Profile Fit Scores) and §5 (Compensation Expectations) are always updated when a profile is created — this is not optional. See `memory/feedback_profile_maintenance.md` for the full checklist including step B4.5.

Before closing a session that performed either operation, output a confirmation line naming which steps were completed. If a step was not applicable, state why.

### Logging Rules

**Every maintenance session:** Append an entry to `$APPLICANT_DIR/applicant-maintenance.md` with: date, session type, summary of what changed, and files updated.

**`career-advice.md` Feedback Incorporated:** Update only when the change directly impacts the advice — e.g., a new target role track added, a skill gap resolved, a recommendation rejected. Do not use as a general change log.

**`APPLICANT-MEMORY.md`:** Do not log maintenance changes to the index. Maintenance content lives in the files themselves and in `applicant-maintenance.md`.

### Files Never Updated During Maintenance

- `*-CONTENT.md` — unless an experience or achievement fact changed; these are pre-compiled from verified sources, not framing documents
- `base-documents/` — setup-only input materials; read-only after Phase E

### Process Rules

When updating how Claude behaves (workflow rules, prompts, memory), edit `CLAUDE.md` or `memory/` in `$APP_DIR` and commit.
