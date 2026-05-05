---
name: Resume generation rules
description: All resume generation rules — review before PDF, role ordering, section headings, Education/Certs, no unverified percentages, Playwright PDF, cover letters, file naming
type: feedback
---

## Review Before PDF

Always complete a full assessment of the resume vs the JD requirements before generating the PDF.

**Why:** First drafts often have gaps, tonal mismatches, or missed opportunities. Reviewing and editing before PDF saves iteration cycles.

**How to apply:**
1. Write the resume .md file
2. Assess it against the JD — score coverage, flag gaps, identify improvements
3. Apply the recommended edits to the .md file
4. Generate the PDF and verify page count
5. Only present to user after this full cycle is complete

## Role Ordering and Structure

**Rule 1: Strict reverse chronological order** — all included roles must appear most-recent-first. Skipping roles is acceptable; out-of-order is not.

**Rule 2: Section heading is "Relevant Experience"** — must be `## RELEVANT EXPERIENCE`, not `## EXPERIENCE` or `## PROFESSIONAL EXPERIENCE`.

**Rule 3: Earlier Career is a subsection** — all roles before 2010 must be grouped under `### Earlier Career` (or `## EARLIER CAREER`). These include: Founding Architect (2005–2010), GalenWorks (2003–2005), Consulting (1999–2003), Financial Services Technology (1985–1999). Within Earlier Career, maintain reverse chronological order.

**How to apply:**
- Use `## RELEVANT EXPERIENCE` always
- Add `### Earlier Career` before any pre-2010 role
- Founding Architect always comes first within Earlier Career
- Never place a pre-2010 role in the main section above a post-2010 role

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

## Cover Letters

Do NOT recommend cover letters by default. They are generally not read or considered by hiring teams.

**How to apply:**
- Do not suggest drafting a cover letter as a next step
- Do not flag the absence of a cover letter as a gap
- Exception: offer one only if the applicant explicitly requests it, the role requires it, or there is a specific signal the hiring manager reviews them
