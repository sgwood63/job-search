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

The applicant directory is synced to Google Drive after every content generation step. To set this up:

**Install the Google Drive desktop app** from [drive.google.com](https://drive.google.com) if not already installed. Sign in and let it complete initial sync.

**Find your Google Drive mount path:**
```bash
ls ~/Library/CloudStorage/
```
You'll see a directory named `GoogleDrive-[your-email@gmail.com]`. The full path to use is:
```
~/Library/CloudStorage/GoogleDrive-[your-email@gmail.com]/My Drive/
```

**Create the target folder in Google Drive:**
```bash
mkdir -p "~/Library/CloudStorage/GoogleDrive-[your-email@gmail.com]/My Drive/Job Search 2026"
```
Or create it in the Google Drive desktop app / Google Drive web UI.

**Test the sync:**
```bash
rsync -av --dry-run --exclude='node_modules' --exclude='_temp-*' \
  ~/Documents/Job-Search-Applicant/ \
  "~/Library/CloudStorage/GoogleDrive-[your-email@gmail.com]/My Drive/Job Search 2026/"
```
Remove `--dry-run` once the paths look right.

**Record your sync command in `CLAUDE.md`** under "Google Drive Sync" so it runs automatically after every content generation step.

### 4. Establish your experience baseline

Create `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md` — the canonical, verified source of every claim you will make in any resume.

Include for each role:
- Exact title, company, dates
- What the company did (one sentence)
- What you specifically did — your actual contributions, not generic job duties
- Technologies, platforms, tools you genuinely used
- Any public credentials (repos, publications, certifications)

**Rule**: If you're not certain a claim is accurate, mark it unverified and clarify before using it. Resumes are generated from this file — not the other way around.

### 5. Define your job profiles

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

### 6. Create applicant context

Create `$APPLICANT_DIR/applicant.md` with:
- Contact information (name, location, email, phone, LinkedIn, GitHub)
- Location preferences (remote-only, hybrid regions, travel limit)
- Role preferences and deal-breakers
- Any other criteria for fit/no-fit screening

### 7. Initialize the tracker

Create `$APPLICANT_DIR/application-tracker.md`:

```markdown
# Job Application Tracker

## Active Applications
| Date | Company | Role | Profile | Source | Status | Next Action | Priority |

## Closed / Rejected
| Date | Company | Role | Outcome | Notes |
```

### 8. Configure session context

Review `CLAUDE.md` in the process repo and update:
- The `$APP_DIR` and `$APPLICANT_DIR` paths (if different from defaults)
- The Google Drive sync command (from step 3 above)
- Any workflow rules you want to adjust

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
