---
name: resume-generation-rules
description: "All resume generation rules — review before PDF, role ordering, section headings, Education/Certs, no unverified percentages, Playwright PDF, cover letters, file naming, recruiter/ATS appeal analysis"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f0ba43a8-e226-4f7c-ac90-cb4c37b4ea99
---

## Resume Generation — Two-Phase Flow

Always follow this two-phase sequence. Never generate the PDF before the user has reviewed and approved the draft.

**Why:** The user wants to review the draft and evaluation before committing to a PDF. Generating PDF first removes the review opportunity and wastes iteration cycles if changes are needed.

**Phase 1 — Draft, evaluate, and present for review:**
1. Write the resume `.md` file
2. Assess vs. JD — score coverage per workflow.md Verification Gate rules (MET / PARTIAL / GAP per requirement)
3. Produce Recruiter & ATS Appeal Analysis (see section below)
4. Write the full Resume Evaluation Report (coverage table + recruiter/ATS analysis) to the `## Resume Evaluation Report` section of `notes.md`
5. **Present the full evaluation report inline in the conversation** — then stop and wait for user review. Do NOT reproduce the resume markdown in the conversation; it is already in the `.md` file.

**Why:** The resume markdown is in the file — the user can open it directly. What must appear in the conversation is the evaluation report (coverage table + recruiter/ATS analysis) so the user can review quality and decide whether to approve the PDF. A condensed summary is not sufficient — the full evaluation must appear in the chat. (Learned: Nash resume 2026-05-13 — condensed summary was shown instead of full evaluation report.)

**Phase 2 — Finalize (after user approves):**
6. Apply any edits from user review
7. Generate PDF and verify page count

## Role Ordering and Structure

**Rule 1: Strict reverse chronological order** — all included roles must appear most-recent-first. Skipping roles is acceptable; out-of-order is not.

**Rule 2: Section heading is "Experience"** — must be `## Experience`, not `## RELEVANT EXPERIENCE` (ATS non-standard) or `## PROFESSIONAL EXPERIENCE`. CSS `text-transform: uppercase` renders it as "EXPERIENCE" in the PDF — the visual output is correct regardless of what case is used in the markdown, but the underlying text must be "Experience" for ATS parsers that look for standard section names.

**Rule 3: Earlier Career is a subsection** — all roles that ended more than 12 years ago must be grouped under `### Earlier Career` (or `## EARLIER CAREER`). The cutoff floats: in 2026 that means roles ending before 2014. Current examples: Founding Architect (ended 2010), GalenWorks (ended 2005), Consulting (ended 2003), Financial Services Technology (ended 1999). Within Earlier Career, maintain reverse chronological order.

**How to apply:**
- Use `## Experience` always — never `## RELEVANT EXPERIENCE`
- Add `### Earlier Career` before any role that ended more than 12 years ago
- Founding Architect always comes first within Earlier Career (most recent of the early roles)
- Never place an early-career role in the main section above a recent role

## Company Descriptions in Role Entries

Include a short company description for every role in the main Experience section. Place it as a brief italicized line immediately after the company name / role title line, before the bullets.

**Format:**
```markdown
**Company Name** | Role Title | Date Range
*Short description — what the company does, stage/size if useful*
- Bullet...
```

**What to include:** 1 line, ≤15 words. What the company does, plus stage or scale if relevant to positioning (e.g. "*AI-powered analytics platform for financial services, Series C*" or "*Global management consulting firm, 300,000+ employees*").

**When to drop:** Only when the target page limit would be exceeded and something must give. Priority order for cutting: company descriptions for less-relevant mid-career roles first, then earlier roles in the main section, then descriptions for well-known brands (where the reader already knows the company).

**Why:** Recruiters often don't recognize company names — especially for startups, mid-market SaaS, and pre-IPO companies. A one-line description removes the "what is this?" gap and keeps the reader focused on the bullet content.

**How to apply:** Check every draft. If any role in the main Experience section lacks a company description, add one before presenting for review. Do not add to Earlier Career entries.

## Capabilities Section Format

Use `, ` (comma-space) as the delimiter between skills in the Capabilities section — not `·` (middle dot).

**Why:** ATS parsers may treat an entire `·`-delimited line as a single token, failing to extract individual skills. Commas are universally recognized as list separators.

**How to apply:** Content library files (`*-CONTENT.md`) store capabilities as bullet lists under bold category headings:

```
**Category Name:**
- Item one
- Item two
- Item three
```

When writing the output resume, flatten each category's bullet list to a single comma-separated inline line:

```
**Category Name:** Item one, Item two, Item three
```

Do not change bullets inside role entries.

## Phone Number Format

Use `(415) 516-4894` — no `+1` country code prefix.

**Why:** Observed in Ashby: name and email parse correctly but phone is blank when `+1 (415) 516-4894` is used. Dropping the country code prefix resolves this.

**How to apply:** Contact block — two lines, using two trailing spaces (markdown `<br>`) after line 1:
- Line 1: `email | (area) exchange-number | linkedin-url`
- Line 2: `City, State`

Placing location first caused Ashby's embedded form parser to fail all fields (observed: Attio 2026-05-11). Parseable fields must come first; location last or on its own line.

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

1. **ATS Performance** — keyword coverage, format risks (delimiter-heavy capability lines, date parsing). Flag if the hiring stack is likely ATS-heavy (large enterprise) vs. light (seed-stage startup).

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

## Age Perception — Standard Mitigations (No Fabrication)

Apply these to every resume without being asked. None involve changing facts.

1. **Remove year ranges from Earlier Career entries.** Dates in Earlier Career are the biggest age signal (e.g., "1985–1999" instantly reveals a 40-year career). Earlier Career is already a compressed section — readers don't expect dates. Remove all year ranges from Earlier Career role names; keep company names and role titles. Do not add "earlier" or vague date placeholders.

2. **Replace "X+ years" language in summaries with positioning language.** "20+ years" (or any tenure anchor) invites mental math. Replace with experience-depth language: "Deep delivery experience spanning..." or "Extensive customer-facing background in..." — equally credible, no calendar anchor.

3. **Omit graduation year from Education.** Never include the year a degree was conferred. University name and degree are sufficient; the year is an age signal with no benefit.

**Why:** These are universally standard resume practices for experienced candidates. No content is removed or misrepresented — only age-calculable dates are withheld from sections where dates add no reader value.

**How to apply:** Check every resume draft before presenting. Flag if any of the three conditions are violated.

## Summary Section — Never Use "## Summary" Heading

Do NOT use `## Summary` as a section heading. It renders as "SUMMARY" (uppercase via CSS) — generic and tells the recruiter nothing.

**Replace with:** A bold positioning title on its own line between the `---` divider and the summary paragraph. The title should reflect the target role and qualifier.

**Format:**
```markdown
---

**[Role Title] — [Domain/Qualifier]**

[Summary paragraph...]
```

**Example:** `**Implementation Engineer — Enterprise SaaS**`

**Why:** A role title immediately anchors the reader to who they're reading about. A bold line (not an h2 heading) avoids the uppercase CSS treatment and renders as a clean subtitle. ATS parsers still read the summary paragraph text normally.

**How to apply:** Every new resume draft. Never use `## Summary`, `## Professional Summary`, or any h2 heading above the opening paragraph.

## Earlier Career — Apply the Same Relevance Filter as the Main Experience Section

Do NOT include all Earlier Career entries by default. Apply the same role/domain relevance judgment used to select bullets in the main Experience section.

Include an Earlier Career entry only if it is relevant to the specific role being applied for or to the target company's domain.

**Canonical entries and their relevance signals:**

| Entry | Relevant to... |
|---|---|
| Jaspersoft — Founding Architect | Tech companies, SaaS implementation/onboarding roles, analytics/BI domain, open source ecosystem |
| GalenWorks — Co-founder | Healthcare domain, clinical analytics, startup-stage companies |
| Consulting (Fireman's Fund, Irish Life) | FS/insurance domain, enterprise architecture roles, regulated industry roles |
| Financial Services Technology (Morgan Stanley, Macquarie) | Financial services domain, investment banking/capital markets |

**Why:** Including irrelevant Earlier Career entries adds wrong-domain signal and dilutes the resume's positioning — the same reason you would omit an irrelevant main Experience bullet.

**How to apply:** For each application, evaluate each Earlier Career entry against the target role and company domain. Include only entries that reinforce the positioning. Omit entries that add noise or wrong-domain signal.
