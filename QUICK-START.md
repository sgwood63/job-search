# Quick Start — Setting Up a New Job Search

## Contents

- [Phase 1: Foundation](#phase-1-foundation-one-time-setup-30-minutes)
  - [Step 1: Run the setup script](#step-1-run-the-setup-script)
  - [Step 2: Run the applicant setup process](#step-2-run-the-applicant-setup-process)
- [Phase 2: Building the Pipeline](#phase-2-building-the-pipeline)
- [Phase 3: Interview Process](#phase-3-interview-process)

---

This guide covers how to bootstrap this system from scratch. If the system is already running, see [USER-GUIDE.md](USER-GUIDE.md) for day-to-day usage.

> **Deployment model:** This guide covers the default local CLI setup (`DATA_BACKEND=local`, Claude Code in terminal or VS Code). If the user wants the web app or OB1 data backend, see [DEPLOYMENT.md](DEPLOYMENT.md) first — it covers all options and explains what to set in `.env` before running the setup script.

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
| Auth | Runs `claude auth status` — exits if Claude Code is not installed; detects OAuth or prompts for API key. **Note:** OAuth works for local Claude Code sessions only. If you plan to run the webapp or OB1 stack via Docker/K8s, also add `ANTHROPIC_API_DEPLOYMENT_KEY` to `.env.services` after setup — OAuth does not work inside containers. See [DEPLOYMENT.md](DEPLOYMENT.md) for full container deployment instructions. |
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

Open a new Claude Code session and run `/setup` (or say "Start the applicant setup process"). Claude reads your uploaded documents and generates a pre-filled questionnaire you complete in your editor, then builds your experience and profile files, gives career direction advice, and validates with sample JDs. The session ends with a sample resume per profile. Takes 1–2 sessions.

See [USER-GUIDE.md → Getting Set Up](USER-GUIDE.md) for what each phase covers and what to bring.

---

## Phase 2: Building the Pipeline

There are two ways jobs enter your pipeline — use either or both:

**Option A — Proactive discovery (recommended):** Run `/ingest [profile]` to search Google Jobs for a given profile. Claude screens results, saves fit jobs as folders with JD files and a notes stub, and adds them to your tracker. Run once per profile every few days. Requires `SEARCHAPI_KEY` in `.env` (see [USER-GUIDE.md → Finding Jobs Proactively](USER-GUIDE.md)).

**Option B — Individual posting:** Provide a job description (URL, PDF, or paste). Claude screens for fit, matches to the best profile, and generates a tailored resume if it's a match.

For either path, once a job is in your pipeline: review the JD stub, request a resume if proceeding, run `/audit [folder]` before submitting, and `/apply "Company" "Role" "date"` after.

See [USER-GUIDE.md → Finding Jobs Proactively](USER-GUIDE.md) and [USER-GUIDE.md → Working With a Job Posting](USER-GUIDE.md) for full workflow details.

---

## Phase 3: Interview Process

After each call, tell Claude who you spoke with and what was said — it updates your notes. Run `/interview [company]` before any call for a targeted prep brief. After the interview, debrief with Claude — gaps and positioning signals carry forward automatically.

See [USER-GUIDE.md → Preparing for an Interview](USER-GUIDE.md) for details.
