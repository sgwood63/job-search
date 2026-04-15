# Quick Start — Setting Up a New Job Search

This guide covers how to bootstrap this system from scratch. If the system is already running, skip to **Daily Use**.

---

## Phase 1: Foundation (One-time setup, ~2 hours)

### 1. Establish your experience baseline

Create `base-documents/EXPERIENCE-REFERENCE.md` — the canonical, verified source of every claim you will make in any resume.

Include for each role:
- Exact title, company, dates
- What the company did (one sentence)
- What you specifically did — your actual contributions, not generic job duties
- Technologies, platforms, tools you genuinely used
- Any public credentials (repos, publications, certifications)

**Rule**: If you're not certain a claim is accurate, mark it as unverified and clarify before using it. This file is the ground truth. Resumes are generated from it — not the other way around.

### 2. Define your job profiles

Identify 2–5 types of roles you're targeting. For each, create:

**`profiles/[profile-name].md`** — Strategy document:
- What makes you strong for this type of role
- How to frame your experience for this audience
- What to emphasize, what to compress
- Target companies and environments

**`profiles/[profile-name]-CONTENT.md`** — Pre-compiled content library:
- Resume bullets organized by role, ready to pull from
- Eliminates re-extraction from PDFs for every application
- Update when base resume changes, not per application

**`profiles/PROFILES-QUICK-REFERENCE.md`** — One-page matching guide:
- Summary of each profile with key signals
- Used for fast initial matching when screening a JD

### 3. Set up resume generation

Install PDF generation dependencies:
```bash
pip install weasyprint
brew install pandoc
```

Verify `templates/resume.css` is present — this is the shared stylesheet. All resumes use it.

Test with any `.md` file:
```bash
pandoc test.md -o test.pdf --pdf-engine=weasyprint --css=templates/resume.css
pdfinfo test.pdf | grep Pages
```

### 4. Configure storage locations

This system writes to two locations — keep both in sync after every file generation:

- **Local**: `~/Documents/Job-Search-2026/`
- **Google Drive**: `~/Library/CloudStorage/GoogleDrive-.../My Drive/Job Search 2026/`

### 5. Initialize the tracker

Create `application-tracker.md` with the structure:

```markdown
# Job Application Tracker

## Active Applications
| Date | Company | Role | Profile | Source | Status | Next Action | Priority |

## Closed / Rejected
| Date | Company | Role | Outcome | Notes |
```

### 6. Initialize memory (if using Claude Code)

Memory files live in `~/.claude/projects/.../memory/` and are mirrored in `memory/` for git tracking.

Seed `MEMORY.md` with:
- User context (location preferences, role preferences, domain interests)
- Key experience facts (quick reference from EXPERIENCE-REFERENCE.md)
- Any rules or preferences you want applied consistently

---

## Phase 2: Applying to a Role

### When you find a job to apply for:

**Step 1 — Screen the JD**

Provide the JD (URL, PDF, or paste). The AI evaluates:
- Location/travel fit
- Profile match (best fit from your 2–5 profiles)
- Overall fit score and gaps

Creates:
- `applications/YYYY-MM-DD-company-role/job-description.md`
- Initial `notes.md` with JD analysis and coverage table
- Tracker entry with status and next action

If no fit: tracker entry with reason. Stop.

**Step 2 — Generate resume**

With the application folder and matched profile identified:
- Load the profile's CONTENT.md library
- Load EXPERIENCE-REFERENCE.md
- Generate tailored resume in Markdown
- Review against JD before generating PDF

```bash
# After review and approval:
pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=../../templates/resume.css
pdfinfo [resume].pdf | grep Pages  # verify 2 pages
```

**Step 3 — Review**

Before submitting, review the resume against the JD:
- Does every bullet have a factual basis in EXPERIENCE-REFERENCE.md?
- Does it read like you, not like a generated document?
- Does it answer: fit, credibility, environment match?

**Step 4 — Submit and track**

After submitting:
- Update `notes.md` with submission date and follow-up date
- Update `application-tracker.md` status to Applied
- Sync both files to Google Drive

---

## Phase 3: Interview Process

### Recruiter / hiring manager call

After each call, update `notes.md`:
- Who you spoke with, their role
- What they said about the process and timeline
- Any signals about what matters to them
- Updated process steps with checkmarks

### Interview prep

Generate prep notes in `notes.md`:
- Likely questions based on role and JD
- Key talking points per question
- Specifics to bring up (projects, metrics, examples)

### Debrief

After each interview:
- What went well / what to improve
- What they emphasized — use for next round prep
- Any new process information

---

## Daily / Weekly Habits

**When something changes** (offer, rejection, interview scheduled):
- Update `application-tracker.md` immediately
- Update the application's `notes.md`
- Sync both to Google Drive

**Weekly (15 min)**:
- Review tracker for pending follow-ups
- Any applications past follow-up date? Send a note.
- Any memory updates needed from recent experience?

**When you learn something new about your experience**:
- Update `base-documents/EXPERIENCE-REFERENCE.md` first
- Then update the relevant `profiles/[profile]-CONTENT.md`
- Memory sync if it's a rule or preference: update `memory/` and commit

---

## Contact Information (for all generated documents)

```
Sherman Wood
San Francisco Bay Area
sgwood63@gmail.com | 415-516-4894
linkedin.com/in/shermanwood | github.com/sgwood63
```

Never use Oakland, CA in resume headers — always San Francisco Bay Area.
No cover letters.
