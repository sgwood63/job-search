# Quick Start — Setting Up a New Job Search

This guide covers how to bootstrap this system from scratch. If the system is already running, skip to **Daily Use**.

---

## Phase 1: Foundation (One-time setup, ~2 hours)

### 1. Create the two directories

```bash
mkdir ~/Documents/Job-Search-2026        # Process repo (git-tracked)
mkdir ~/Documents/Job-Search-Applicant   # Applicant data (not git-tracked)
```

Initialize the process repo as a git repo. Do NOT initialize the applicant directory — it contains PII.

### 2. Install PDF generation dependencies

```bash
pip install weasyprint
brew install pandoc poppler   # poppler provides pdfinfo
```

Verify `templates/resume.css` is present in the process repo. All resumes use it.

Test PDF generation:
```bash
pandoc test.md -o test.pdf --pdf-engine=weasyprint --css=templates/resume.css
pdfinfo test.pdf | grep Pages
```

### 3. Map Google Drive for sync

The applicant directory is synced to Google Drive after every content generation step.

**Install the Google Drive desktop app** from [drive.google.com](https://drive.google.com) if not already installed. Sign in and let it complete its initial sync before continuing.

**Find your Google Drive mount path (macOS):**
```bash
ls ~/Library/CloudStorage/
```
You'll see a directory named `GoogleDrive-[your-email@gmail.com]`. Note the full path:
```
/Users/[you]/Library/CloudStorage/GoogleDrive-[your-email@gmail.com]/My Drive
```

For other operating systems, see the path notes in `.env.example`.

**Create the target folder:**
```bash
mkdir -p "/Users/[you]/Library/CloudStorage/GoogleDrive-[your-email@gmail.com]/My Drive/Job Search 2026"
```
Or create it in the Google Drive web UI — it will appear at that path once synced.

### 4. Configure environment

All top-level paths are set in a single `.env` file. Scripts and Claude Code load this file at runtime. It is gitignored and never committed.

```bash
cp .env.example .env
```

Open `.env` and fill in the three variables using the paths from steps 1–3:

```bash
export APP_DIR="/Users/[you]/Documents/Job-Search-2026"
export APPLICANT_DIR="/Users/[you]/Documents/Job-Search-Applicant"
export GDRIVE_DIR="/Users/[you]/Library/CloudStorage/GoogleDrive-[your-email@gmail.com]/My Drive/Job Search 2026"
```

**Verify the environment loads and the sync path works:**
```bash
source .env
echo "APP_DIR=$APP_DIR"
echo "APPLICANT_DIR=$APPLICANT_DIR"
echo "GDRIVE_DIR=$GDRIVE_DIR"

rsync -av --dry-run --exclude='node_modules' --exclude='_temp-*' \
  "$APPLICANT_DIR/" "$GDRIVE_DIR/"
```
The dry run shows what would be transferred without copying anything. Fix any path errors before continuing.

### 5. Establish your experience baseline

Create `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md` — the canonical, verified source of every claim you will make in any resume.

Include for each role:
- Exact title, company, dates
- What the company did (one sentence)
- What you specifically did — your actual contributions, not generic job duties
- Technologies, platforms, tools you genuinely used
- Any public credentials (repos, publications, certifications)

**Rule**: If you're not certain a claim is accurate, mark it unverified and clarify before using it. Resumes are generated from this file — not the other way around.

### 6. Define your job profiles

Identify 2–5 types of roles you're targeting. For each, create files in `$APPLICANT_DIR/profiles/`:

**`[profile-name].md`** — Strategy document:
- What makes you strong for this role type
- How to frame your experience for this audience
- What to emphasize, what to compress
- Target companies and environments

**`[profile-name]-CONTENT.md`** — Pre-compiled content library:
- Resume bullets organized by role, ready to pull from
- Eliminates re-extraction from PDFs per application
- Update when base resume changes, not per application

**`PROFILES-QUICK-REFERENCE.md`** — One-page matching guide:
- Summary of each profile with key signals
- Used for fast initial matching when screening a JD

### 7. Create applicant context

Create `$APPLICANT_DIR/applicant.md` with:
- Contact information (name, location, email, phone, LinkedIn, GitHub)
- Location preferences (remote-only, hybrid regions, travel limit)
- Role preferences and deal-breakers
- Any other criteria for fit/no-fit screening

### 8. Initialize the tracker

Create `$APPLICANT_DIR/application-tracker.md`:

```markdown
# Job Application Tracker

## Active Applications
| Date | Company | Role | Profile | Source | Status | Next Action | Priority |

## Closed / Rejected
| Date | Company | Role | Outcome | Notes |
```

### 9. Configure session context

`CLAUDE.md` reads all paths from `.env` at session start — no manual path edits needed there. Review `CLAUDE.md` only if you want to change workflow rules or resume generation standards.

---

## Phase 2: Applying to a Role

### When you find a job to apply for:

**Step 1 — Provide the JD**

Give Claude Code the job description (URL, PDF, or paste). It will automatically:
- Screen for location/travel fit against `$APPLICANT_DIR/applicant.md`
- Match to the best profile from `$APPLICANT_DIR/profiles/`
- Create `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/`
- Generate resume and notes if fit; log with reason if no fit
- Update the tracker
- Sync to Google Drive

**Step 2 — Review the resume**

Claude generates the resume, self-reviews it against the JD, applies improvements, then generates the PDF. Review:
- Does every bullet have a factual basis in EXPERIENCE-REFERENCE.md?
- Does it read like the applicant, not like a generated document?
- Does it answer: fit, credibility, environment match?

**Step 3 — Submit and track**

After submitting:
- Update `notes.md` with submission date and follow-up date
- Update `application-tracker.md` status to Applied
- Sync to Google Drive

---

## Phase 3: Interview Process

### After each call, update `notes.md`:
- Who you spoke with and their role
- What they said about the process and timeline
- Any signals about what matters to them

### Interview prep

Ask Claude to generate prep notes in `notes.md`:
- Likely questions based on role and JD
- Key talking points per question
- Specifics to bring up (projects, metrics, examples)

### Debrief

After each interview, add to `notes.md`:
- What went well / what to improve
- What they emphasized — use for next round prep
- Any new process information

---

## Daily / Weekly Habits

**When something changes** (offer, rejection, interview scheduled):
- Update `application-tracker.md` immediately
- Update the application's `notes.md`
- Sync to Google Drive

**Weekly (15 min)**:
- Review tracker for pending follow-ups
- Any applications past follow-up date? Send a note.

**When you learn something new about your experience**:
- Update `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md` first
- Then update the relevant `profiles/[profile]-CONTENT.md`
- If it's a process rule: update `memory/` in the process repo and commit

**When you want to change how Claude behaves**:
- Edit `CLAUDE.md` for auto-loaded rules
- Edit `memory/feedback_*.md` for specific rules indexed by CLAUDE.md
- Commit both

---

## Memory and Process Rules

Process memory lives in two places:

| Location | Purpose |
|---|---|
| `CLAUDE.md` | Auto-loaded at session start — complete workflow and rules |
| `memory/MEMORY.md` + `memory/feedback_*.md` | Detailed rules referenced from CLAUDE.md; git-tracked |
| `$APPLICANT_DIR/memory/` | Applicant-specific context (not in process repo) |

To update a rule:
1. Edit the relevant file in `memory/` (or `CLAUDE.md` directly)
2. Commit: `git add memory/ CLAUDE.md && git commit -m "Update memory: [what changed]"`
