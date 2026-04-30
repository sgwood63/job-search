# Quick Start — Setting Up a New Job Search

This guide covers how to bootstrap this system from scratch. If the system is already running, skip to **Daily Use**.

**Before you begin:**

1. **Install Claude Code** — download the desktop app at [claude.ai/code](https://claude.ai/code) or run `npm install -g @anthropic-ai/claude-code`. This is the AI runtime for the entire system. `scripts/setup.sh` will exit if it cannot find Claude Code.
2. **Install a cloud sync app** *(optional)* — Google Drive, OneDrive, Dropbox, iCloud, or Box. If installed, setup will detect it and offer to store applicant files inside the service's managed folder so they sync automatically.

---

## Phase 1: Foundation (One-time setup, ~30 minutes)

### Step 1: Run the setup script

After cloning this repo, run the interactive setup script from the repo root:

```bash
bash scripts/setup.sh
```

The script detects whether an existing applicant is already configured and offers a **refresh** path (re-check deps, auth, and sync) or a **new applicant** path:

| Step | What it does |
|---|---|
| Auth | Runs `claude auth status` — exits if Claude Code is not installed; detects OAuth or prompts for API key |
| Existing check | If a valid `.env` + applicant directory is found, offers to refresh the existing setup and exit |
| Applicant name | Prompts for the applicant's full name |
| 1 | Installs PDF generation dependencies — pandoc, poppler, weasyprint (checks first, skips if installed) |
| 2 | Detects installed cloud sync services; presents a numbered menu — Local (default `~/Documents/job-applications`) or any detected service; sets `APPLICANT_DIR` to the chosen location |
| 3 | Writes `.env` with `APPLICANT_NAME`, `APP_DIR`, `APPLICANT_DIR`, and auth config |
| 4 | Scaffolds the applicant directory with stub files; pre-fills `applicant.md` with the applicant name |

Existing files are never overwritten — safe to re-run (triggers the refresh path).

`.env` is gitignored and never committed. To update any value, edit `.env` directly or re-run `bash scripts/setup.sh`.

To activate the environment in your current shell after setup:
```bash
source .env
```

### Step 2: Run the applicant setup process

Open a new Claude Code session and follow [applicant-setup.md](applicant-setup.md). This guided process replaces manual file-filling — Claude interviews the applicant, extracts content from uploaded documents, and generates all required files:

- `applicant.md` — contact info, location preferences, role criteria
- `base-documents/EXPERIENCE-REFERENCE.md` — verified facts for every role
- `profiles/[name].md` + `profiles/[name]-CONTENT.md` — one pair per target role type
- `profiles/PROFILES-QUICK-REFERENCE.md` — fast JD-matching index

The session ends with profile validation against example JDs and a sample resume for each profile.

### Step 3: Configure session context

`CLAUDE.md` reads all paths from `.env` at session start — no manual path edits needed. Review `CLAUDE.md` only if you want to change workflow rules or resume generation standards.

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

**Step 2 — Review the resume**

Claude generates the resume, self-reviews it against the JD, applies improvements, then generates the PDF. Review:
- Does every bullet have a factual basis in EXPERIENCE-REFERENCE.md?
- Does it read like the applicant, not like a generated document?
- Does it answer: fit, credibility, environment match?

**Step 3 — Submit and track**

After submitting:
- Update `notes.md` with submission date and follow-up date
- Update `application-tracker.md` status to Applied

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
