---
name: feedback_jd_file_saving
description: Rules for saving JD files — verbatim raw text in jd-*.md, structured summary in job-description.md; both required for every application
type: feedback
---

For every JD processed, two files must be created in the application folder:

1. **`jd-<company>-<role>.md`** — verbatim raw text from the source (never a summary or extraction):
   - URL source → full page text via `fetch-jd.py --md-out <filepath> <url>`
   - PDF source → copy of original PDF file (use .pdf extension)
   - Pasted text → verbatim paste as-is

2. **`job-description.md`** — structured extraction with key info:
   - Company, title, location, compensation, travel
   - Role overview (summarized)
   - Required and preferred qualifications
   - Source URL and reference to original JD file name

**Why:** The applicant explicitly asked for raw JD text to be saved. Summaries are not a substitute — the verbatim source is needed for reference, future re-analysis, and audit. The structured job-description.md serves navigation; the raw jd-*.md preserves fidelity.

**How to apply:**
- Both files must be created before moving to resume generation or notes
- `jd-*.md` must contain the verbatim source text — not an extraction, not a reformatted version
- `fetch-jd.py --md-out` syntax: `"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out <filepath> <url>`

**JD fetch fallback chain — always attempt in order:**
1. Try `WebFetch` on the URL
2. If `WebFetch` fails or returns a login wall, run `"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out <filepath> <url>`
3. If Playwright exits 2 (auth required), show the user the stderr setup command (`--setup <url>`) and wait
4. If Playwright exits 1, or Playwright is unavailable, require user to paste the raw text or upload a file — do not skip

Never stop at step 1 failure without attempting step 2.

**Post-regeneration sync:** After updating jd-*.md or job-description.md for an existing application, compare the new fit assessment against the current notes.md status and tracker row. If regeneration reveals a status change (hard stop confirmed, job closed, deadline passed), apply the two-file rule (notes.md + tracker) before closing the task. See `workflow.md §JD Regeneration`.
