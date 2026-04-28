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

The setup happens in four phases, run as a single Claude chat session:

1. **Upload documents** — gather and place source materials in `$APPLICANT_DIR/base-documents/`
2. **Interview the applicant** — draw out preferences, profile targets, and resume guidance
3. **Generate initial documents** — produce all the files Claude needs to run applications
4. **Validate with example JDs** — confirm profiles are right before the live search starts

---

## Phase A — Upload Documents

Before the interview, upload source documents to `$APPLICANT_DIR/base-documents/`:

| What | Format | Notes |
|---|---|---|
| Demographic / contact info | Any | Name, location, email, phone, LinkedIn URL |
| LinkedIn profile | PDF or HTML | Export from LinkedIn → "Save as PDF" |
| Existing resumes | PDF or Word | All versions; Claude will extract from them |
| Cover letters (if any) | PDF or Word | Optional but useful for voice calibration |
| Example JDs (optional) | PDF, HTML, or URL | Roles the applicant already has in mind |

For JDs provided as URLs: fetch the HTML content and save as a PDF in `base-documents/`.

---

## Phase B — Interview the Applicant

With the documents uploaded, run a guided interview. Cover all of the following:

### Job profiles and preferences
- What types of roles is the applicant targeting? (title, function, seniority)
- What are the must-haves vs. nice-to-haves in a role?
- What are the deal-breakers? (compensation floor, travel limit, culture fit)
- What roles are they explicitly NOT interested in?

### Target role profiles
- For each role type: what makes the applicant strong for it?
- How should their experience be framed for that audience?
- What should be emphasized? What compressed or omitted?

### Resume format guidance
- 1-page or 2-page per profile? (default: 2-page for enterprise/consulting; 1-page for networking/pre-sales/pivots)
- Any special format requirements from the applicant's industry or target companies?

### Job search strategy
- Where are target roles typically posted? (LinkedIn, Greenhouse, Lever, Built In, niche boards)
- Search keywords and filters that work best for each profile
- Networking channels and warm referral sources the applicant has

### Visibility and search activity
- Is the applicant open to being found? (LinkedIn "Open to Work" settings)
- Recruiter outreach strategy — how to respond, what to screen for
- Any existing recruiter relationships to activate?

---

## Phase C — Generate Initial Documents

After the interview, generate the following files. Do not fabricate — use only what came from the uploaded documents and the interview.

### `$APPLICANT_DIR/applicant.md`
Contact info, location preferences, role preferences, and deal-breakers. This is the file Claude checks on every JD screen.

### `$APPLICANT_DIR/profiles/[profile-name].md` (one per profile)
Strategy document per role type:
- What makes the applicant strong for this profile
- Framing guidance for experience and accomplishments
- What to emphasize / compress / omit
- Keywords and signals for this audience

### `$APPLICANT_DIR/profiles/[profile-name]-CONTENT.md` (one per profile)
Pre-compiled resume content library:
- Opening summaries per profile
- Achievement bullets organized by role, ready to pull from
- Eliminates per-application re-extraction from PDF resumes

### `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
One-row summary per profile for fast JD matching. Claude uses this as the first lookup during screening.

### `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md`
Verified fact sheet for every role:
- Exact title, company, and dates
- What the company did (one sentence)
- Specific contributions — not generic job duties
- Technologies and tools actually used
- Verifiable metrics or outcomes

Mark any uncertain claims `[UNVERIFIED]`. This is the canonical source of truth — resumes are generated from it, never the reverse.

### `$APPLICANT_DIR/base-documents/achievements-worksheet.md` (optional)
Pulled from resumes and the interview initially. Offer to review and edit achievements with the applicant during this session. Can be extended in later sessions.

### `$APPLICANT_DIR/base-documents/resume-content-guidance.md`
Format rules per profile: 1-page vs. 2-page, section structure, what to include/exclude, tone.

### Session summary document
Save a summary of the interview chat to `$APPLICANT_DIR/base-documents/applicant-interview-[date].md`. This becomes a reference for future sessions and can be extended with follow-up chats.

---

## Phase D — Profile Validation with Example JDs

Once profiles are generated:

1. **Find example JDs** matching each profile — search LinkedIn, Greenhouse, Lever, Built In using the keywords identified in Phase B
2. **Store JD content** in the relevant profile file under an "Example JDs" section
3. **Review for fit** — for each example JD, run the standard screening check against `applicant.md`
4. **Generate a sample resume** for one well-fitting JD per profile — this stress-tests the content library and surfaces gaps before live applications begin
5. **Iterate** — update profiles, CONTENT files, or EXPERIENCE-REFERENCE as gaps emerge

---

## After Setup

The applicant can review and update any of these files at any time. Common reasons to update:

- **`applicant.md`** — preferences shift, new deal-breakers emerge, compensation target changes
- **`EXPERIENCE-REFERENCE.md`** — completing a project, remembering a detail, adding a metric
- **`profiles/`** — new role type to target, framing improvement after an interview
- **`base-documents/achievements-worksheet.md`** — capturing a new accomplishment

When updating process rules (how Claude behaves), edit `CLAUDE.md` or `memory/` in the process repo and commit.
