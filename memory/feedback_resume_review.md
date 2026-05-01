---
name: feedback_resume_review
description: Resume generation rules — review before PDF, no percentage metrics, Playwright PDF generation, no title duplication, correct file naming
type: feedback
originSessionId: 92dfb0eb-bd42-476d-ae34-d5414d71d670
---
When generating resumes, always complete a full assessment of the resume vs the JD requirements before generating the PDF.

**Why:** First drafts often have gaps, tonal mismatches, or missed opportunities that should be fixed before committing to PDF. Doing the review and edits in one step saves iteration cycles.

**How to apply:**
1. Write the resume .md file
2. Assess it against the JD — score coverage, flag gaps, identify improvements
3. Apply the recommended edits to the .md file
4. Then generate the PDF and verify page count
5. Only present to user after this full cycle is complete

## Percentage Metrics in Resume Bullets

Do NOT use unverified or estimated percentage metrics in resume bullets (e.g. "improved speed by 30%", "reduced time by 20%", "200% user growth" where the figure is approximate or unmeasured).

**Why:** The applicant has explicitly asked for estimated percentages to be removed. Approximate X% claims undermine credibility if challenged; verified figures are acceptable.

**How to apply:**
- **Verified, sourced percentages are allowed** — if the number comes from a real measurement or a document, use it.
- **Unverified/estimated X% form must be avoided** — replace with qualitative language: "substantially improved", "significantly reduced", "materially shortened", "scaled to support significant growth".
- **Counts and named outputs are always fine** — 50+ engagements, 400+ customers, 156 GitHub stars, etc.
- Scan every bullet before generating the PDF and flag any X% claim that lacks a source.

## PDF Generation — Always Use Playwright Script

Always generate PDFs via `$APP_DIR/scripts/generate-pdf.py` (Playwright). Never use Chrome `--print-to-pdf` directly.

**Why:** Chrome's `--print-to-pdf` adds the filename to the header and the file:// path to the footer. These must not appear. The Playwright script produces: date (right, header) + page number (center, footer) only.

**How to apply:**
```bash
source "$APP_DIR/.env"
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

## Title Format

Do NOT include a frontmatter `title:` block. The resume should open directly with the applicant's name as a top-level heading — no YAML front matter, no "[Name] — Resume" line above it.

**Why:** The frontmatter title renders as a duplicate heading — the name appears twice on the page.

## File Naming Convention

Resume `.md` and `.pdf` files must be named: `[FirstName_LastName]_<JD_role_title>` with spaces replaced by underscores and special characters (parentheses, pipes) removed or replaced with underscores. Derive the name from `$APPLICANT_DIR/applicant.md`.

Example: role "GRC Solutions Engineer" → `[FirstName_LastName]_GRC_Solutions_Engineer.md` / `.pdf`

**Why:** Generic `resume.md` / `resume.pdf` filenames don't identify which role the file is for.
