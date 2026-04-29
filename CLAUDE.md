# Claude Code — Job Search 2026

This file is auto-loaded at session start. It contains all rules and context needed to operate correctly.

## Directory Paths

Canonical paths are defined in `$APP_DIR/.env` (gitignored). Read that file at session start to resolve path variables. If `.env` is not present, ask the user to create it from `.env.example`.

| Variable | Defined in `.env` | Notes |
|---|---|---|
| `$APP_DIR` | Yes | Process repo, git-tracked |
| `$APPLICANT_DIR` | Yes | Applicant data, NOT git-tracked |

`$APP_DIR` is git-tracked. `$APPLICANT_DIR` is NOT git-tracked (contains applicant PII and application files).

Applicant-specific context (identity, location, experience, job criteria) is in `$APPLICANT_DIR/applicant.md`.

## New Applicant Setup — DO NOT ASK, JUST DO

When the user says "start setup", "set up applicant", "run applicant setup", or expresses clear intent to begin the new applicant onboarding process:

1. Verify `.env` is loaded and `$APPLICANT_DIR` exists — if not, tell the user to run `bash scripts/setup.sh` first
2. Read `$APP_DIR/applicant-setup.md` for the full process
3. Execute **Phase A** (document upload): tell the user exactly what to upload and where, wait for confirmation
4. Execute **Phase B** (interview): work through each topic, ask questions, take notes — do not rush or batch
5. Execute **Phase C** (generate documents): produce all files using only what was gathered; present each for review before moving on
6. Execute **Phase D** (profile validation): find example JDs, store them, run fit checks, generate one sample resume per profile
7. Use **Sonnet** throughout — this is generative work, not screening

Pause at the end of each phase and confirm with the user before proceeding to the next.

## Automated Workflow — DO NOT ASK, JUST DO

When the user provides a job description (URL, document, or paste):

### Step 1 — Fetch the JD Content

**Try WebFetch first.** If it returns a login wall (page title/body contains "sign in", "authwall", "join now", etc.) or fails:

1. Fall back to `"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" "<url>"` (requires `.env` sourced for `$PLAYWRIGHT_PYTHON`)
2. If exit code 2 (auth required): tell the user to run the setup command printed to stderr — do not proceed until they confirm auth is done, then retry
3. If exit code 1 (navigation error): ask the user to paste the JD text directly

**PDF and document JDs:** Use `pdftotext` or ask the user to paste if WebFetch fails.

### Step 1b — Use Haiku for Initial Screening
Spawn a Haiku agent to:
- Fetch/extract JD content (using whichever fetch method succeeded above)
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
- Stop

### If FIT (switch to Sonnet for quality)
- Read `$APPLICANT_DIR/profiles/[matched-profile].md` and its `-CONTENT.md`
- Generate tailored resume (see Resume Generation Rules below)
- Create detailed `notes.md` (JD analysis, interview prep hooks)
- Update `$APPLICANT_DIR/application-tracker.md` (Active Applications)
- Present for user review

## notes.md Structure Rules

Every `notes.md` must include a **Table of Contents** immediately after the header block (title, date, status, profile, fit). The TOC must reflect the actual sections in the file using markdown anchor links.

### Required Section Order

1. Table of Contents
2. JD Analysis
3. Fit Assessment
4. Resume Strategy
5. Company Research
6. Notes from Recruiter Interview *(add when available)*
7. Process *(hiring process steps)*
8. Interview Prep sections — **in chronological interview order** (e.g., HM interview before technical screen before panel)
9. Process Reminder *(recap of next steps)*

### Interview Prep Section Rules
- Each interview stage gets its own H2: `## Interview Prep N — [Stage Name]`
- Sections appear in the order the interviews occur — never out of sequence
- Within each interview prep section, subsections follow this order: Logistics → Research → Talking Points → Technical Questions → Questions to Ask → Differentiators / What Not to Bring Up

## Profiles Directory

`$APPLICANT_DIR/profiles/` is the working source of truth for resume generation:
- `EXPERIENCE-REFERENCE.md` — canonical verified career history; source for Education and Certifications sections
- `role-achievements.md` — **canonical source for all achievement bullet text and metrics** (verified or qualitative); changes here must propagate downstream: `role-achievements.md` → `EXPERIENCE-REFERENCE.md` → `*-CONTENT.md`
- `[profile].md` — positioning strategy and framing guidance per profile
- `[profile]-CONTENT.md` — pre-compiled bullet library for resume generation
- `PROFILES-QUICK-REFERENCE.md` — fast-match index for Haiku screening

`$APPLICANT_DIR/base-documents/` contains setup inputs (uploaded PDFs, interview notes, source resumes). Do not access it after setup unless the applicant is adding new source material to support an updated or new profile.

## File Storage

Applicant files are stored directly in `$APPLICANT_DIR`, which is set during `bash scripts/setup.sh` to either a local directory or a cloud sync service's managed local folder (Google Drive, OneDrive, iCloud, Dropbox, or Box). When a cloud service is chosen, the OS syncs `$APPLICANT_DIR` automatically — no separate step needed.

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

### File Naming Convention
Resume `.md` and `.pdf` files must be named `Sherman_Wood_<Role_Title>.md` / `.pdf` — spaces replaced by underscores, special characters removed.

Example: "Principal Solution Architect" → `Sherman_Wood_Principal_Solution_Architect.md` / `.pdf`

Set `RESUME_MD` and `RESUME_PDF` variables to this pattern before running the PDF command.

### PDF Generation Command
Always use the Playwright script — never `--print-to-pdf` via Chrome directly (Chrome adds filename/filepath to header/footer).

```bash
source "$APP_DIR/.env"
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

Output: date in header (right), page number in footer (center), no filename or filepath anywhere.

### Length
- **2 pages** — enterprise, consulting, governance, direct applications
- **1 page** — networking, warm referrals, recruiter outreach, pre-sales SE roles, role pivoting

### Required Sections — Every Resume

Every resume must include these sections, in this order, after Relevant Experience:

1. **`## Education`** — always present, regardless of role type or page count
2. **`## Certifications`** — always present

Content for both sections must be copied verbatim from `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`. Do not omit them. Do not derive content from memory or context.

### Section Labels
- Experience section: **`## RELEVANT EXPERIENCE`** — never "Experience" or "Professional Experience"
- Roles that ended more than 12 years ago must be grouped under **`### Earlier Career`** (subsection under Relevant Experience), not listed individually in the main section

### Role Ordering — Strict Reverse Chronological
- All included roles: most-recent-first, no exceptions
- Skipping roles is OK; displaying them out of order is not
- Earlier Career entries also follow reverse chronological order — verify against `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`

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
- Capabilities section: categorized format with bold labels — see `$APP_DIR/templates/resume-format.md` for the required format and rules
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
source "$APP_DIR/.env"
# 1. Edit files in $APP_DIR/memory/
# 2. Commit:
git -C "$APP_DIR" add memory/
git -C "$APP_DIR" commit -m "Update memory: [what changed]"
# 3. Sync to live memory (derive .claude project path from $APP_DIR):
CLAUDE_MEM="$HOME/.claude/projects/$(echo "$APP_DIR" | sed 's|/|-|g; s|^-||')/memory/"
cp "$APP_DIR/memory/"*.md "$CLAUDE_MEM"
```

Applicant-specific memory lives in `$APPLICANT_DIR/memory/` and is managed separately.

## Cost Optimization

- Use **Haiku** for JD screening (12x cheaper than Sonnet)
- Use quick-reference profiles for initial matching
- Switch to **Sonnet** only for document generation
- Reuse resume extraction within a session
