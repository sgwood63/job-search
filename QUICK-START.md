# Quick Start — Setting Up a New Job Search

This guide covers how to bootstrap this system from scratch. If the system is already running, skip to **Daily Use**.

**Before you begin:**

1. **Install Claude Code** — download the desktop app at [claude.ai/code](https://claude.ai/code) or run `npm install -g @anthropic-ai/claude-code`. This is the AI runtime for the entire system.
2. **Get an Anthropic API key** — at [console.anthropic.com](https://console.anthropic.com). The automated workflow calls Claude Haiku (JD screening) and Claude Sonnet (document generation) directly via the API. `scripts/setup.sh` will prompt you for this key.
3. **Install Google Drive desktop app** — download from [drive.google.com](https://drive.google.com), sign in, and let it complete its initial sync before running setup.

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
| 5 | Writes `.env`; runs a dry-run rsync to verify sync works |
| 6 | Scaffolds the applicant directory: all subdirectories plus stub files for `applicant.md`, `application-tracker.md`, `EXPERIENCE-REFERENCE.md`, `resume-content-guidance.md`, `PROFILES-QUICK-REFERENCE.md`, and `APPLICANT-MEMORY.md` |

Existing files are never overwritten — safe to re-run.

`.env` is gitignored and never committed. To update any value, edit `.env` directly or re-run `bash scripts/setup.sh`.

For Windows or Linux Google Drive paths, see `.env.example` for the correct format.

To activate the environment in your current shell after setup:
```bash
source .env
```

### 2. Fill in `applicant.md`

Open `$APPLICANT_DIR/applicant.md` (created by setup) and fill in:
- Contact information (name, location, email, phone, LinkedIn, GitHub)
- Location preferences (remote-only, hybrid regions, travel limit)
- Role preferences and deal-breakers

This file is used by Claude to screen every JD for fit.

### 3. Fill in `EXPERIENCE-REFERENCE.md`

Open `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md` (created by setup) and document every role:
- Exact title, company, and dates
- What the company did (one sentence)
- Your specific contributions — not generic job duties
- Technologies and tools you genuinely used
- Verifiable metrics or outcomes

**Rule**: If you're not certain a claim is accurate, mark it `[UNVERIFIED]`. Resumes are generated from this file — never the other way around.

### 4. Define your profiles

For each type of role you're targeting, create two files in `$APPLICANT_DIR/profiles/`:

**`[profile-name].md`** — Strategy document:
- What makes you strong for this role type
- How to frame your experience for this audience
- What to emphasize, what to compress

**`[profile-name]-CONTENT.md`** — Pre-compiled content library:
- Resume bullets organized by role, ready to pull from
- Eliminates per-application re-extraction from PDFs
- Update when your experience changes, not per application

Then fill in `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md` with a one-row summary per profile. Claude uses this for fast JD matching.

### 5. Configure session context

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
