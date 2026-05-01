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
2. For each role, display a table with columns: `# | Achievement | Power | P1 | P2 | P3 | P? | Notes`
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
Save a summary of the interview chat to `$APPLICANT_DIR/base-documents/applicant-feedback.md`. This becomes a reference for future sessions and can be extended with follow-up chats.

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

Update `$APPLICANT_DIR/profiles` content if the discussion surfaces framing improvements or new profile priorities. Append a summary of the conversation to `$APPLICANT_DIR/base-documents/applicant-feedback.md`.

---

## Phase E — Profile Validation with Example JDs

Once profiles and career advice are reviewed:

1. **Find example JDs** matching each profile — use JDs from base-documents and search LinkedIn, Greenhouse, Lever, Built In using the keywords identified in Phase C to get to 2-3 per profile
2. **Review for fit** — for each example JD, run the standard screening check against `applicant.md`, noting they are examples
3. **Generate a sample resume** for one well-fitting JD per profile — this stress-tests the content library and surfaces gaps before live applications begin

---

## After Setup

The applicant can review and update any of these files at any time manually or via interaction with Claude. Common reasons to update:

- **`applicant.md`** — preferences shift, new deal-breakers emerge, compensation target changes
- **`$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`** — completing a project, remembering a detail, adding a metric
- **`$APPLICANT_DIR/profiles/`** — new role type to target, framing improvement after an interview
- **`$APPLICANT_DIR/profiles/role-achievements.md`** — capturing a new accomplishment
- **`$APPLICANT_DIR/base-documents/applicant-feedback.md`** — session notes and applicant responses from setup interviews; extend with follow-up conversations

When updating process rules (how Claude behaves), edit `CLAUDE.md` or `memory/` in the process repo and commit.
