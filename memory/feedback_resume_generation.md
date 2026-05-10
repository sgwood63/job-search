---
name: Resume generation rules
description: All resume generation rules — review before PDF, role ordering, section headings, Education/Certs, no unverified percentages, Playwright PDF, cover letters, file naming, recruiter/ATS appeal analysis
type: feedback
---

## Resume Generation — Two-Phase Flow

Always follow this two-phase sequence. Never generate the PDF before the user has reviewed and approved the draft.

**Why:** The user wants to review the draft and evaluation before committing to a PDF. Generating PDF first removes the review opportunity and wastes iteration cycles if changes are needed.

**Phase 1 — Draft, evaluate, and present for review:**
1. Write the resume `.md` file
2. Assess vs. JD — score coverage per workflow.md Verification Gate rules (MET / PARTIAL / GAP per requirement)
3. Produce Recruiter & ATS Appeal Analysis (see section below)
4. Write the full Resume Evaluation Report (coverage table + recruiter/ATS analysis) to the `## Resume Evaluation Report` section of `notes.md`
5. Present the `.md` file and evaluation to the user for review — stop here and wait

**Phase 2 — Finalize (after user approves):**
6. Apply any edits from user review
7. Generate PDF and verify page count

## Role Ordering and Structure

**Rule 1: Strict reverse chronological order** — all included roles must appear most-recent-first. Skipping roles is acceptable; out-of-order is not.

**Rule 2: Section heading is "Relevant Experience"** — must be `## RELEVANT EXPERIENCE`, not `## EXPERIENCE` or `## PROFESSIONAL EXPERIENCE`.

**Rule 3: Earlier Career is a subsection** — all roles that ended more than 12 years ago must be grouped under `### Earlier Career` (or `## EARLIER CAREER`). The cutoff floats: in 2026 that means roles ending before 2014. Current examples: Founding Architect (ended 2010), GalenWorks (ended 2005), Consulting (ended 2003), Financial Services Technology (ended 1999). Within Earlier Career, maintain reverse chronological order.

**How to apply:**
- Use `## RELEVANT EXPERIENCE` always
- Add `### Earlier Career` before any role that ended more than 12 years ago
- Founding Architect always comes first within Earlier Career (most recent of the early roles)
- Never place an early-career role in the main section above a recent role

## Education and Certifications

Every resume must include Education and Certifications sections at the bottom, after Earlier Career.

**Standard format:** Copy these sections verbatim from `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`. Do not paraphrase, reorder, or abbreviate.

**Why:** Omitting them is inconsistent; ATS systems explicitly require them.

## Percentage Metrics in Bullets

Do NOT use unverified or estimated percentage metrics (e.g. "improved speed by 30%" where the figure is approximate or unmeasured).

**How to apply:**
- **Verified, sourced percentages are allowed** — use them if the number comes from a real measurement or document
- **Unverified/estimated X% form must be avoided** — replace with: "substantially improved", "significantly reduced", "materially shortened"
- **Counts and named outputs are always fine** — 50+ engagements, 400+ customers, 156 GitHub stars
- Scan every bullet before generating the PDF and flag any X% claim that lacks a source

## PDF Generation — Always Use Playwright Script

Always generate PDFs via `$APP_DIR/scripts/generate-pdf.py`. Never use Chrome `--print-to-pdf` directly.

**Why:** Chrome adds the filename to the header and the file:// path to the footer. The Playwright script produces: date (right header) + page number (center footer) only.

**Command:**
```bash
source "$APP_DIR/.env"
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

## File Naming

Resume `.md` and `.pdf` files: `[FirstName_LastName]_<JD_role_title>` — spaces → underscores, special characters removed or replaced with underscores. Derive name from `$APPLICANT_DIR/applicant.md`.

Example: "GRC Solutions Engineer" → `[FirstName_LastName]_GRC_Solutions_Engineer.md` / `.pdf`

## Title Format

Do NOT include a frontmatter `title:` block. The resume must open directly with the applicant's name as a top-level heading — no YAML front matter above it.

**Why:** The frontmatter title renders as a duplicate heading — the name appears twice on the page.

## Recruiter & ATS Appeal Analysis (Required After Every Resume)

After the JD requirement scoring, produce a second analysis block covering real-world response likelihood. This is separate from "does the resume cover the requirements" — it answers "will this resume actually get read and acted on."

**Why:** JD coverage scoring tells you what's in the resume. It doesn't tell you what a recruiter sees in 6 seconds, whether ATS will parse it correctly, or whether structural factors (company name recognition, career span visibility, format density) will sink it before anyone reads the content. The user found this analysis specifically useful and wants it every time.

**How to apply:** After the JD evaluation table, produce a section with four subsections:

1. **ATS Performance** — keyword coverage, format risks (non-standard headers, delimiter-heavy capability lines, date parsing). Flag if the hiring stack is likely ATS-heavy (large enterprise) vs. light (seed-stage startup). Note that `RELEVANT EXPERIENCE` is a non-standard header some parsers miss.

2. **Recruiter Eye Scan (6 seconds)** — what the recruiter actually sees first: positioning line, company name brand recognition, summary scannability, career span visibility from date math. Be specific about which company names have recognition and which don't. Flag if the summary is a dense paragraph block (hard to skim) vs. scannable.

3. **Structural factors** — anything that affects response odds regardless of content quality: company size/stage fit with career profile, age signal visibility from date ranges, simultaneous contracts reading as fractional, lack of F500 brand names in recent roles, absence of quantified outcomes. Be honest — these are real factors.

4. **Response likelihood estimate** — a honest probability range (e.g. "15–25%") with specific factors for and against. Not optimistic cheerleading. End with the single most impactful thing that would improve odds (warm intro, specific reframe, cutting a section, etc.).

**Tone:** Honest and direct. The applicant explicitly values candor over reassurance.

## Cover Letters

Do NOT recommend cover letters by default. They are generally not read or considered by hiring teams.

**How to apply:**
- Do not suggest drafting a cover letter as a next step
- Do not flag the absence of a cover letter as a gap
- Exception: offer one only if the applicant explicitly requests it, the role requires it, or there is a specific signal the hiring manager reviews them
