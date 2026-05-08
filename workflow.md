# Automated JD Workflow

This document describes the full automated pipeline that runs when a job description is provided. CLAUDE.md contains the triggers and critical rules; this file has the detailed steps.

---

## Step 1 — Fetch the JD

**Try WebFetch first.** If it returns a login wall (page title/body contains "sign in", "authwall", "join now", etc.) or fails:

1. Fall back to `"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" "<url>"`
2. Exit code 2 (auth required): tell the user to run the setup command printed to stderr — do not proceed until they confirm auth is done, then retry. Auth files live in `$APPLICANT_DIR/.auth/`. Re-run `--setup <url>` or `--import <domain>` to refresh expired cookies. If prompted for manual entry: DevTools (F12) → Application → Cookies → copy the session cookie name and value.
3. Exit code 1 (navigation error): ask the user to paste the JD text directly

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

- Create brief `notes.md` with no-fit reasoning
- Update `$APPLICANT_DIR/application-tracker.md` (Rejected/Closed section)
- Stop

---

## If FIT (switch to Sonnet)

- Read `$APPLICANT_DIR/profiles/[matched-profile]/[matched-profile].md` and `-CONTENT.md`
- Read `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`
- Generate tailored resume (see Resume Generation below)
- Create detailed `notes.md` (see notes.md Structure below)
- Update `$APPLICANT_DIR/application-tracker.md` (Active Applications)
- Present for user review

**After the user submits:** Run `/audit [folder-name]` to verify completeness, then `/apply "Company" "Role" "date"` to record the submission in both the tracker and notes.md atomically.

---

## notes.md Structure

Every `notes.md` must include a **Table of Contents** immediately after the header block (title, date, status, profile, fit source URL).

### Required Section Order

1. Table of Contents
2. JD Analysis *(full source URL + original JD filename)*
3. Fit Assessment *(include a "Domain Connection" subsection — see CLAUDE.md Critical Rules)*
4. Resume Strategy
5. Company Research
6. Notes from Recruiter Interview *(add when available)*
7. Process *(hiring process steps)*
8. Interview Prep sections — **in chronological interview order** (e.g., HM interview before technical screen before panel)
9. Process Reminder *(recap of next steps)*

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

1. Write the resume `.md` file
2. **Verification gate** — run a coverage check against job-description.md:
   - Extract every stated requirement (Required and Preferred separately)
   - Score each Required item: **MET** (a specific bullet addresses it), **PARTIAL** (mentioned but not specific), or **GAP** (not addressed)
   - **Exit condition:** all Required items are MET or PARTIAL
   - If GAPsexist on Required items: apply targeted edits and re-score — maximum 2 cycles
   - If a Required item remains a GAP after 2 cycles: flag it explicitly rather than continuing to loop
3. Output the coverage table alongside the resume draft — it is the deliverable, not a post-hoc report
4. Generate PDF and verify page count
5. Only present to user after this full cycle

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

- Experience section: `## RELEVANT EXPERIENCE` (all caps) — never "Experience" or "Professional Experience"
- Roles that ended more than 12 years ago: grouped under `### Earlier Career` (subsection of Relevant Experience, reverse chronological within it)

### Role Ordering

All roles: most-recent-first, no exceptions. Skipping roles is OK; displaying them out of order is not. Verify against `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md` before generating.

### Content Library Headers Are Not Job Titles

Headers like "AI Solution Architect - Presales Experience" in `-CONTENT.md` files are source material labels. Never render them as job entries in the resume.

### After Generating

The coverage table produced during step 2 is the primary evaluation artifact. Also summarize:
- Overall effectiveness and competitive positioning vs. the JD
- Any differentiators surfaced or missed
- Any explicit gaps (Required items that remained GAP after 2 cycles) and recommended mitigation

---

## Unknown Company Research

For JDs where the end company is not explicitly named (recruiter postings, stealth, "confidential client"):
- Research using JD clues: product description phrases, location, comp range, recruiter name, industry/stage signals
- Cross-reference job boards (Built In, Ashby, Lever, Greenhouse) for exact matches
- Look for near word-for-word matches between JD and company marketing copy
- Record findings under "Company Research" in `job-description.md` and "Company Context" in `notes.md`
- Add tracker entry with "likely [Company Name]" qualifier
