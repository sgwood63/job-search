# Automated JD Workflow

This document describes the full automated pipeline that runs when a job description is provided. CLAUDE.md contains the triggers and critical rules; this file has the detailed steps.

---

## Step 1 — Fetch the JD

**Try WebFetch first.** If it returns a login wall (page title/body contains "sign in", "authwall", "join now", etc.) or fails:

1. Fall back to `"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" "<url>"`
2. Exit code 2 (auth required): tell the user to run the setup command printed to stderr — do not proceed until they confirm auth is done, then retry. Auth files live in `$APPLICANT_DIR/.auth/`. Re-run `--setup <url>` or `--import <domain>` to refresh expired cookies. If prompted for manual entry: DevTools (F12) → Application → Cookies → copy the session cookie name and value.
3. Exit code 1 (navigation error): ask the user to paste the JD text directly
4. Exit code 3 (job closed): the posting is no longer available or the position has been filled.
   - Search `$APPLICANT_DIR/applications/` for an existing folder whose slug matches this company and role (fuzzy: lowercase folder name contains the company name and a fragment of the role title)
   - **If an existing application IS found:**
     - Update `notes.md`: set `**Status:**` to `Closed` and `**Status Detail:**` to `Closed — position no longer available (YYYY-MM-DD)`
     - Append to the `## Application Log` section: `YYYY-MM-DD — Position confirmed closed/no longer available via URL fetch`
     - Update `application-tracker.md`: move the row from Active Applications to the Rejected/Closed section; set `Status` to `Closed` and `Status Detail` to `Position closed (YYYY-MM-DD)`; set Date to today
     - Inform the user: "This job posting is no longer available. Application [folder] status updated to Closed."
   - **If no existing application is found:**
     - Inform the user: "This job posting is no longer available — position appears closed or filled. No further processing."
   - In both cases: stop — do not proceed with screening or document generation

**PDF and document JDs:** Use `pdftotext` or ask the user to paste if WebFetch fails.

---

## Step 2 — Screen with Haiku

Spawn a Haiku agent to:
- Extract: company, role, location, travel requirement, compensation, core requirements
- Check location/travel fit against `$APPLICANT_DIR/applicant.md`
- Match to best profile using `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
- Return: fit/no-fit decision with reasoning, best profile name

---

## Step 3 — Create Application Folder (every JD, fit or no-fit)

Folder: `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/`

Save the following:
- `job-description.md` — full JD text plus extracted key info (company, role, location, travel, comp, requirements)
- Original JD content as a separate file named `jd-<company>-<role-title>.[ext]` (lowercase, spaces → hyphens, special characters removed):
  - **URL source:** `"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out "$FOLDER/jd-<company>-<role>.md" "<url>"`
  - **PDF source:** copy the original PDF to `$FOLDER/jd-<company>-<role>.pdf`
  - **Pasted text:** save verbatim to `$FOLDER/jd-<company>-<role>.md`
- In `notes.md` JD Analysis section: record the full source URL (if URL-sourced) and the original filename saved

---

## If NO FIT (stay in Haiku)

- Create brief `notes.md` with no-fit reasoning; header must include `**Status:** Closed` and `**Status Detail:** No fit — [reason]`
- Update `$APPLICANT_DIR/application-tracker.md` (Closed/Rejected section); set `Status = Closed`, `Status Detail = No fit — [reason]`
- Stop

---

## If FIT (switch to Sonnet)

- Read `$APPLICANT_DIR/profiles/[matched-profile]/[matched-profile].md` and `-CONTENT.md`
- Read `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`
- Generate tailored resume (see Resume Generation below)
- Create detailed `notes.md` (see notes.md Structure below); header must include `**Status:** Resume Ready` and `**Status Detail:** Resume generated [YYYY-MM-DD] — not yet submitted`
- Update `$APPLICANT_DIR/application-tracker.md` (Active Applications); set `Status = Resume Ready`, `Status Detail = Resume generated [YYYY-MM-DD] — not yet submitted`
- Present for user review

**After the user submits:** Run `/audit [folder-name]` to verify completeness, then `/apply "Company" "Role" "date"` to record the submission in both the tracker and notes.md atomically.

---

## JD Regeneration (Existing Applications)

When regenerating `jd-*.md` and/or `job-description.md` for an existing application folder (e.g., batch re-fetch, /ingest re-run, manual JD update):

1. After writing the updated files, compare the new `job-description.md` fit assessment against the current `notes.md` **Status** line and the tracker row.
2. If the new data reveals a status change — confirmed hard stop, closed posting, passed deadline, domain mismatch, or materially changed fit score — apply the two-file rule immediately:
   - Update `notes.md`: set `**Status:**` to the new canonical value and `**Status Detail:**` to the free-text reason; replace Next Steps with a Decision section explaining the reason
   - Update `application-tracker.md`: update the `Status` and `Status Detail` columns on the Active row, or move to Closed as appropriate
3. Do not close the regeneration task without checking for status drift. Regeneration without sync leaves notes.md and the tracker stale.

---

## notes.md Structure

Every `notes.md` must include a **Table of Contents** immediately after the header block.

### Header Block

The header block (before the TOC) must include these fields in order:

```
**Status:** <canonical>          ← one of: Pending Review | Resume Ready | Applied | Interview scheduled | Interviewed | Exercise/Test requested | Exercise/Test | Offer | Closed
**Status Detail:** <free text>   ← full context: dates, flags, recruiter names, etc.
**Date:** YYYY-MM-DD
**Profile:** <profile-name>
**Source URL:** <url>            ← omit if no URL
```

Both `Status` and `Status Detail` must be kept in sync with the matching row in `application-tracker.md` at all times (two-file rule).

### Required Section Order

1. Table of Contents
2. JD Analysis *(full source URL + original JD filename)*
3. Fit Assessment *(include a "Domain Connection" subsection — see CLAUDE.md Critical Rules)*
4. Resume Strategy
5. Resume Evaluation Report *(JD requirement coverage table + Recruiter & ATS Appeal Analysis — see feedback_resume_generation.md)*
6. Company Research
7. Notes from Recruiter Interview *(add when available)*
8. Process *(hiring process steps)*
9. Interview Prep sections — **in chronological interview order** (e.g., HM interview before technical screen before panel)
10. Process Reminder *(recap of next steps)*
11. Application Log

### Interview Prep Section Rules
- Each stage gets its own H2: `## Interview Prep N — [Stage Name]`
- Sections appear in the order the interviews occur — never out of sequence
- Within each section: Logistics → Research → Talking Points → Technical Questions → Questions to Ask → Differentiators / What Not to Bring Up

---

## Resume Generation Pipeline

### File Naming

Set variables before running the PDF command. Derive the applicant's name from `$APPLICANT_DIR/applicant.md`.

```
RESUME_MD="$FOLDER/[FirstName_LastName]_<Role_Title>.md"
RESUME_PDF="$FOLDER/[FirstName_LastName]_<Role_Title>.pdf"
RESUME_HTML="$FOLDER/resume.html"
```

Spaces → underscores, special characters removed. Example: "GRC Solutions Engineer" → `[FirstName_LastName]_GRC_Solutions_Engineer.md`

### Generation Steps

**Phase 0 — Role Classification check (before drafting):**

Verify every role to be included in this resume has a `**Role Classification:**` field in `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`. If any included role is missing one, stop and ask the user to provide it before generating any bullets. Do not infer role type from activity descriptions — the user must confirm.

**Phase 1 — Draft, evaluate, and present for review (stop here, wait for approval):**

1. Write the resume `.md` file
2. **Verification gate** — run a coverage check against job-description.md:
   - Extract every stated requirement (Required and Preferred separately)
   - Score each Required item: **MET** (a specific bullet addresses it), **PARTIAL** (mentioned but not specific), or **GAP** (not addressed)
   - **Exit condition:** all Required items are MET or PARTIAL
   - If GAPs exist on Required items: apply targeted edits and re-score — maximum 2 cycles
   - If a Required item remains a GAP after 2 cycles: flag it explicitly rather than continuing to loop
3. Produce Recruiter & ATS Appeal Analysis — see `memory/feedback_resume_generation.md` for the four-subsection format (ATS performance, recruiter eye scan, structural factors, response likelihood estimate)
4. Write the complete Resume Evaluation Report (coverage table + recruiter/ATS analysis) to the `## Resume Evaluation Report` section of `notes.md`
5. Present the `.md` file and evaluation to the user for review — **stop here and wait for approval**

**Phase 2 — Finalize (after user approves):**

6. Apply any edits from user review
7. Generate PDF and verify page count

### PDF Command

Always use the Playwright script — never `--print-to-pdf` via Chrome directly (Chrome adds filename/filepath to header/footer).

```bash
source "$APP_DIR/.env"
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

For 1-page resumes, add `--css="$APP_DIR/templates/one-page-override.css"` to the pandoc command.

Output: date in header (right), page number in footer (center), no filename or filepath anywhere.

### Required Resume Sections (every resume)

After Relevant Experience, always include in this order:
1. `## Education` — copied verbatim from `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`
2. `## Certifications` — copied verbatim from `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`

### Section Labels

- Experience section: `## Experience` — CSS `text-transform: uppercase` renders it as "EXPERIENCE" in the PDF; never use `## RELEVANT EXPERIENCE` (ATS non-standard) or "Professional Experience"
- Roles that ended more than 12 years ago: grouped under `### Earlier Career` (subsection of Relevant Experience, reverse chronological within it)

### Role Ordering

All roles: most-recent-first, no exceptions. Skipping roles is OK; displaying them out of order is not. Verify against `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md` before generating.

### Content Library Headers Are Not Job Titles

Headers like "AI Solution Architect - Presales Experience" in `-CONTENT.md` files are source material labels. Never render them as job entries in the resume.

### After Generating

The Resume Evaluation Report (written to `notes.md` in step 4) is the primary evaluation artifact. It must include:
- Coverage table: every JD requirement scored MET / PARTIAL / GAP
- Overall effectiveness and competitive positioning vs. the JD
- Any differentiators surfaced or missed
- Any explicit gaps (Required items that remained GAP after 2 cycles) and recommended mitigation
- Recruiter & ATS Appeal Analysis — see `memory/feedback_resume_generation.md` for the full four-subsection spec

---

## Unknown Company Research

For JDs where the end company is not explicitly named (recruiter postings, stealth, "confidential client"):
- Research using JD clues: product description phrases, location, comp range, recruiter name, industry/stage signals
- Cross-reference job boards (Built In, Ashby, Lever, Greenhouse) for exact matches
- Look for near word-for-word matches between JD and company marketing copy
- Record findings under "Company Research" in `job-description.md` and "Company Context" in `notes.md`
- Add tracker entry with "likely [Company Name]" qualifier
