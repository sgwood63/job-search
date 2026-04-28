---
name: feedback_resume_review
description: Resume generation rules — review before PDF, no title duplication, correct file naming convention
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

## Title Format

Do NOT include a frontmatter `title:` block. The resume should open directly with `# Sherman Wood` — no YAML front matter, no "Sherman Wood — Resume" line above it.

**Why:** The frontmatter title renders as a duplicate heading — the name appears twice on the page.

## File Naming Convention

Resume `.md` and `.pdf` files must be named: `Sherman_Wood_<JD_role_title>` with spaces replaced by underscores and special characters (parentheses, pipes) removed or replaced with underscores.

Example: role "GRC Solutions Engineer" → `Sherman_Wood_GRC_Solutions_Engineer.md` / `.pdf`

**Why:** Generic `resume.md` / `resume.pdf` filenames don't identify which role the file is for.
