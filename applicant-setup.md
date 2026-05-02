# Applicant Setup Process

## How to Start

**Prerequisite:** `scripts/setup.sh` must have been run first (creates directories, `.env`, and stub files).

Open a Claude Code session in the `$APP_DIR` repo directory and say:

> **"Start the applicant setup process"**

Claude will read this file and execute each phase in order, pausing between phases for your input.

---

This document describes how to onboard a new applicant into the job search system. It augments [QUICK-START.md](QUICK-START.md), which covers the technical foundation (directory creation, dependencies, storage setup). Run the technical setup first, then use this process to populate the applicant's data.

---

## Overview

The setup happens in five phases, run as a single Claude chat session:

1. **Upload documents** — gather and place source materials in `$APPLICANT_DIR/base-documents/`
2. **Interview the applicant** — draw out demographics and preferences
3. **Generate initial documents** — produce all the files Claude needs to run job applications: experience breakdown, target job profiles, achievements with scores
4. **Provide career advice** — analyze fit and positioning, suggest target roles, identify skill gaps and quick wins
5. **Validate with example JDs** — confirm profiles are right before the live search starts

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

## Phase B — Interview the Applicant

With the documents uploaded, run a guided interview. Cover all of the following:

### Demographics
- Confirm details from base-documents
- Get additional details that might affect employment prospects, like age, location, willingness to relocate
- Suggest additional details that could be useful for resumes

### Job preferences
- What are the must-haves vs. nice-to-haves in a role? What are the deal-breakers? (like compensation floor, travel limit, culture fit, company type, product type, industry)
- What roles are they explicitly NOT interested in?
- What goals do you have for the next position? (Increased salary? More seniority? Move to management? At minimum, match or exceed prior compensation?)
- When do you want to start work? Now, when something becomes available

### Visibility and search activity
- What the applicant is currently doing to be found? (LinkedIn "Open to Work" settings)
- Any existing recruiter relationships to activate?

---

## Phase C — Generate Initial Documents

After the interview, generate the following files. Do not fabricate — use only what came from the uploaded documents and the interview.

### `$APPLICANT_DIR/applicant.md`
Contact info, location preferences, role preferences, and deal-breakers, goals. This is the file Claude checks on every JD screen.

### `$APPLICANT_DIR/profiles/[profile-name].md` (one per profile)

Strategy document per role type:
- What makes the applicant strong for this profile
  - score the strength of the applicant for the role, based on their experience
- Framing guidance for experience and accomplishments
- What to emphasize / compress / omit
- Keywords and signals for this audience
- What resume format generally applies for the role? Any special format requirements from the applicant's industry or target companies?
- Where the role is typically posted: like LinkedIn, Indeed, Greenhouse, Lever, Built In, niche boards
  - Search keywords and filters that work best for the profile specific to the posting site

### `$APPLICANT_DIR/profiles/[profile-name]-CONTENT.md` (one per profile)
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

### `$APPLICANT_DIR/base-documents/resume-content-guidance.md`
Format rules per profile: 1-page vs. 2-page, section structure, what to include/exclude, tone.

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

1. **Find example JDs** matching each profile — use JDs from base-documents and search LinkedIn, Greenhouse, Lever, Built In using the keywords identified in Phase C to get to 2-3 per profile
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
- Contains: One-row profile summary per profile; scoring rules; hard stops
- Read by: Haiku screening agent for profile selection and fit scoring
- Update when: Profile added or removed; scoring rules change; new JD signals identified; hard stops change

**`profiles/[profile].md`** (one per profile)
- Contains: Positioning strategy, framing guidance, what to emphasize/compress/omit, target companies, keywords
- Read by: Sonnet during resume generation
- Update when: Positioning or framing changes (e.g., new delivery emphasis); profile added or deprecated; emphasis priorities shift

**`profiles/[profile]-CONTENT.md`** (one per profile)
- Contains: Pre-compiled resume bullets by role — factual, sourced content only
- Read by: Sonnet during resume generation (primary bullet source)
- Update when: A role fact changes; a new verified achievement is added; an [UNVERIFIED] claim is resolved; a new role is added
- Do NOT update for framing changes — framing lives in the strategy file, not here

**`profiles/EXPERIENCE-REFERENCE.md`**
- Contains: Verified fact sheet for every role: exact title, company, dates, contributions, technologies, verified metrics
- Read by: Sonnet during resume generation (no-fabrication source of truth)
- Update when: New role added; fact corrected; metric verified or resolved from [UNVERIFIED]; tenure explanation confirmed

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

### Logging Rules

**Every maintenance session:** Append an entry to `$APPLICANT_DIR/applicant-maintenance.md` with: date, session type, summary of what changed, and files updated.

**`career-advice.md` Feedback Incorporated:** Update only when the change directly impacts the advice — e.g., a new target role track added, a skill gap resolved, a recommendation rejected. Do not use as a general change log.

**`APPLICANT-MEMORY.md`:** Do not log maintenance changes to the index. Maintenance content lives in the files themselves and in `applicant-maintenance.md`.

### Files Never Updated During Maintenance

- `*-CONTENT.md` — unless an experience or achievement fact changed; these are pre-compiled from verified sources, not framing documents
- `base-documents/` — setup-only input materials; read-only after Phase E

### Process Rules

When updating how Claude behaves (workflow rules, prompts, memory), edit `CLAUDE.md` or `memory/` in `$APP_DIR` and commit.
