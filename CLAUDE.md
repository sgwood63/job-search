# Claude Code — Job Search 2026

This file is auto-loaded at session start. It contains all rules and context needed to operate correctly.

## Directory Paths

| Variable | Path |
|---|---|
| `$APP_DIR` | `/Users/shermanwood/Documents/Job-Search-2026/` |
| `$APPLICANT_DIR` | `/Users/shermanwood/Documents/Job-Search-Applicant/` |

`$APP_DIR` is git-tracked. `$APPLICANT_DIR` is NOT git-tracked (contains applicant PII and application files).

Applicant-specific context (identity, location, experience, job criteria) is in `$APPLICANT_DIR/applicant.md`.

## Automated Workflow — DO NOT ASK, JUST DO

When the user provides a job description (URL, document, or paste):

### Step 1 — Use Haiku for Initial Screening
Spawn a Haiku agent to:
- Fetch/extract JD content
- Extract: company, role, location, travel requirement, compensation, core requirements
- Check location/travel fit against `$APPLICANT_DIR/applicant.md`
- Match to best profile using `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
- Return: fit/no-fit decision with reasoning, best profile name

### Step 2 — Create Application Folder (every JD, fit or no-fit)
- Folder: `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/`
- Save `job-description.md` with full JD text and extracted key info

### If NO FIT (stay in Haiku)
- Create brief `notes.md` with no-fit reasoning
- Update `$APPLICANT_DIR/application-tracker.md` (Rejected/Closed section)
- Sync to Google Drive (see below)
- Stop

### If FIT (switch to Sonnet for quality)
- Read `$APPLICANT_DIR/profiles/[matched-profile].md` and its `-CONTENT.md`
- Generate tailored resume (see Resume Generation Rules below)
- Create detailed `notes.md` (JD analysis, interview prep hooks)
- Update `$APPLICANT_DIR/application-tracker.md` (Active Applications)
- Sync to Google Drive (see below)
- Present for user review

## Google Drive Sync

After ANY content generation (application folder, resume, notes, tracker update), run:

```bash
rsync -av --exclude='node_modules' --exclude='_temp-*' \
  /Users/shermanwood/Documents/Job-Search-Applicant/ \
  "/Users/shermanwood/Library/CloudStorage/GoogleDrive-sgwood63@gmail.com/My Drive/Job Search 2026/"
```

Never skip this step.

## Resume Generation Rules

### No Fabrication
- ONLY use information from actual base resume (extract with `pdftotext` if needed)
- Do NOT invent companies, titles, achievements, metrics, projects, skills, or certifications
- If uncertain about a fact, ASK — never guess

### Resume Review Before PDF
1. Write the resume `.md` file
2. Assess it against the JD — score each requirement, flag gaps, identify improvements
3. Apply the edits to the `.md` file
4. Then generate PDF and verify page count
5. Only present to user after this full cycle is complete

### Length
- **2 pages** — enterprise, consulting, governance, direct applications
- **1 page** — networking, warm referrals, recruiter outreach, pre-sales SE roles, role pivoting

### Section Labels
- Experience section: **`## RELEVANT EXPERIENCE`** — never "Experience" or "Professional Experience"
- All roles before 2010 must be grouped under **`### Earlier Career`** (subsection under Relevant Experience), not listed individually in the main section

### Role Ordering — Strict Reverse Chronological
- All included roles: most-recent-first, no exceptions
- Skipping roles is OK; displaying them out of order is not
- Earlier Career order (most recent first): Founding Architect (2005–2010) → GalenWorks (2003–2005) → Consulting (1999–2003) → Financial Services Technology (1985–1999)
- Always verify role order against `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md`

### Content Library Section Headers Are NOT Job Titles
- Headers like "AI Solution Architect - Presales Experience" in content library files are source material labels
- Never render them as job entries in the resume

### Detail Per Role
- Recent roles (last 10–12 years): 5–7 bullets
- Mid-career (12–20 years ago): 2–4 bullets
- Early career (20+ years): 1 bullet or title only

### Signal Density
- Bullet formula: **Action → Technical Domain → Context → Outcome**
- Use hands-on IC verbs: designed, implemented, architected, built, delivered
- Avoid management language (led large teams, departmental strategy, oversaw transformation)
- Capabilities section: use technology *categories*, not exhaustive tool lists — specific tools go in role bullets
- Write natural sentences with embedded keywords — not ATS keyword stuffing

### No Duplication
- Capabilities section items must not overlap — merge any that cover the same domain
- Each achievement must appear in the role period where it actually occurred

### After Generating
Produce a **detailed evaluation report**: score each JD requirement vs. resume coverage, flag gaps, assess overall effectiveness and competitive positioning.

## Workflow Rules

### Company Lookup
When the user references a company not already in conversation context:
1. Check `$APPLICANT_DIR/application-tracker.md` for all entries for that company
2. Exactly one entry → proceed with that context
3. Multiple entries → confirm which position is relevant (include "new position" as an option)
4. No entry → treat as new company/JD to screen

### Unknown Company Research
For JDs where the end company is not explicitly named (recruiter postings, stealth, "confidential client"):
- Run research using JD clues: product description phrases, location, comp range, recruiter name, industry/stage signals
- Cross-reference job boards (Built In, Ashby, Lever, Greenhouse) for exact matches
- Look for near word-for-word matches between JD and company marketing copy
- Record findings under "Company Research" in `job-description.md` and "Company Context" in `notes.md`
- Add tracker entry with "likely [Company Name]" qualifier

## Session Strategy

Use short, task-scoped sessions (one application, one interview prep, one memory update). Long sessions degrade through repeated context compression.

Before ending a session, save anything important that isn't already in memory files.

## Memory Sync Rule

`$APP_DIR/memory/` is the source of truth for process memory. After editing memory files:

```bash
# 1. Edit files in /Users/shermanwood/Documents/Job-Search-2026/memory/
# 2. Commit:
git -C /Users/shermanwood/Documents/Job-Search-2026 add memory/
git -C /Users/shermanwood/Documents/Job-Search-2026 commit -m "Update memory: [what changed]"
# 3. Sync to live memory:
cp /Users/shermanwood/Documents/Job-Search-2026/memory/*.md \
   ~/.claude/projects/-Users-shermanwood-Documents-Job-Search-2026/memory/
```

Applicant-specific memory lives in `$APPLICANT_DIR/memory/` and is managed separately.

## Cost Optimization

- Use **Haiku** for JD screening (12x cheaper than Sonnet)
- Use quick-reference profiles for initial matching
- Switch to **Sonnet** only for document generation
- Reuse resume extraction within a session
