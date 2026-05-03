# Quick Start — Setting Up a New Job Search

## Contents

- [Phase 1: Foundation](#phase-1-foundation-one-time-setup-30-minutes)
  - [Step 1: Run the setup script](#step-1-run-the-setup-script)
  - [Step 2: Run the applicant setup process](#step-2-run-the-applicant-setup-process)
- [Phase 2: Applying to a Role](#phase-2-applying-to-a-role)
- [Phase 3: Interview Process](#phase-3-interview-process)

---

This guide covers how to bootstrap this system from scratch. If the system is already running, see [USER-GUIDE.md](USER-GUIDE.md) for day-to-day usage.

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
| 1 | Installs PDF generation dependencies — pandoc, poppler (checks first, skips if installed); detects Playwright Python installation |
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

Open a new Claude Code session and run `/setup` (or say "Start the applicant setup process"). Claude interviews you, builds your experience and profile files, gives career direction advice, and validates with sample JDs. The session ends with a sample resume per profile. Takes 1–2 sessions.

See [USER-GUIDE.md → Getting Set Up](USER-GUIDE.md) for what each phase covers and what to bring.

---

## Phase 2: Applying to a Role

Provide the job description (URL, PDF, or paste). Claude screens for fit, matches to the best profile, and generates a tailored resume if it's a match. Review the draft, request a cover letter or portal question answers if needed, then run `/audit [folder]` before submitting and `/apply "Company" "Role" "date"` after.

See [USER-GUIDE.md → Working With a Job Posting](USER-GUIDE.md) for the full workflow with examples.

---

## Phase 3: Interview Process

After each call, tell Claude who you spoke with and what was said — it updates your notes. Run `/interview [company]` before any call for a targeted prep brief. After the interview, debrief with Claude — gaps and positioning signals carry forward automatically.

See [USER-GUIDE.md → Preparing for an Interview](USER-GUIDE.md) for details.
