# Quick Start — Setting Up a New Job Search

This guide covers how to bootstrap this system from scratch. If the system is already running, skip to **Daily Use**.

**Prerequisite:** Install the [Google Drive desktop app](https://drive.google.com), sign in, and let it complete its initial sync before running setup.

---

## Phase 1: Foundation (One-time setup, ~30 minutes)

### Steps 1–4: Run the setup script

After cloning this repo, run the interactive setup script from the repo root:

```bash
bash scripts/setup.sh
```

The script walks you through each step with confirmation prompts and sensible defaults:

| Step | What it does |
|---|---|
| 1 | Creates the applicant data directory (defaults to a sibling of this repo) |
| 2 | Installs PDF generation dependencies — pandoc, poppler, weasyprint (checks first, skips if already installed) |
| 3 | Auto-detects your Google Drive mount path on macOS; creates the sync target folder |
| 4 | Sets your Anthropic API key — defaults to any key already in your shell environment |
| 5 | Writes `.env` with all paths; runs a dry-run rsync to verify sync works |

`.env` is gitignored and never committed. To update any value, edit `.env` directly or re-run `bash scripts/setup.sh`.

For Windows or Linux Google Drive paths, see `.env.example` for the correct format.

To activate the environment in your current shell after setup:
```bash
source .env
```

### 2. Establish your experience baseline

Create `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md` — the canonical, verified source of every claim you will make in any resume.

Include for each role:
- Exact title, company, dates
- What the company did (one sentence)
- What you specifically did — your actual contributions, not generic job duties
- Technologies, platforms, tools you genuinely used
- Any public credentials (repos, publications, certifications)

**Rule**: If you're not certain a claim is accurate, mark it unverified and clarify before using it. Resumes are generated from this file — not the other way around.

### 3. Define your job profiles

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

### 4. Create applicant context

Create `$APPLICANT_DIR/applicant.md` with:
- Contact information (name, location, email, phone, LinkedIn, GitHub)
- Location preferences (remote-only, hybrid regions, travel limit)
- Role preferences and deal-breakers
- Any other criteria for fit/no-fit screening

### 5. Initialize the tracker

Create `$APPLICANT_DIR/application-tracker.md`:

```markdown
# Job Application Tracker

## Active Applications
| Date | Company | Role | Profile | Source | Status | Next Action | Priority |

## Closed / Rejected
| Date | Company | Role | Outcome | Notes |
```

### 6. Configure session context

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
