# Job Search Assistant — User Guide

## Contents

- [What This System Does](#what-this-system-does)
- [Using the Web App](#using-the-web-app)
  - [Starting the Web App](#starting-the-web-app)
  - [Tracker View](#tracker-view)
  - [Application View](#application-view)
  - [Base Docs View](#base-docs-view)
  - [Setup Guide](#setup-guide)
  - [Command Launcher and Terminal](#command-launcher-and-terminal)
  - [Documentation View](#documentation-view)
- [Getting Set Up](#getting-set-up)
  - [Prerequisites](#prerequisites)
  - [Step 1 — Run the setup script](#step-1--run-the-setup-script)
  - [Step 2 — Start the applicant setup conversation](#step-2--start-the-applicant-setup-conversation)
- [Working With a Job Posting](#working-with-a-job-posting)
  - [Step 1: Get a resume draft](#step-1-get-a-resume-draft)
  - [Step 2: Review and refine the draft](#step-2-review-and-refine-the-draft)
  - [Step 3: Check it's ready to submit](#step-3-check-its-ready-to-submit)
  - [Step 4: Record the submission](#step-4-record-the-submission)
  - [Step 5: Follow up](#step-5-follow-up)
- [Generating Application Content](#generating-application-content)
- [Preparing for an Interview](#preparing-for-an-interview)
- [Updating Your Profile (Any Time)](#updating-your-profile-any-time)
- [Making Manual Edits](#making-manual-edits)
- [Checking Your Pipeline](#checking-your-pipeline)
- [Starting a Conversation](#starting-a-conversation)
- [Command Quick Reference](#command-quick-reference)
- [Troubleshooting](#troubleshooting)

---

## What This System Does

One setup: you describe your background, experience, and goals once. After that, the system does the heavy lifting for every application.

- **Profile and career advice** — the setup process analyzes your background, gives career direction advice, and generates target role profiles so every application draws from pre-vetted, accurately-voiced content.
- **JD evaluation and scoring** — when you provide a job description, the system screens it for fit, scores it against your criteria, and gives you a reason before doing any resume work.
- **Tailored resumes, cover letters, and application content** — resumes are generated from your verified content library; cover letters and portal question answers are produced in the same voice, from the same facts.
- **Full-cycle tracking** — application status, interview prep, post-call notes, and debrief feedback all live in one place; corrections and new experience automatically carry forward into future applications.

**How to start:** Open Claude Code, navigate to this folder, and start typing. Context loads automatically at the beginning of every conversation.

---

## Using the Web App

The web app gives you a browser-based interface to manage your job search: view your pipeline, browse and edit application files, upload documents, run assistant commands, and work through the guided setup — all without leaving the browser.

### Starting the Web App

From the repo root:

```bash
cd webapp
./start.sh
```

`start.sh` checks that the resolved Claude Code binary is version 2.1.152 or later before starting. If it's too old, it prints the required upgrade command and exits. Set `CLAUDE_BINARY` in `.env` to pin to a specific binary path (e.g. the VS Code extension's bundled binary); defaults to `claude` in PATH.

**If `DATA_BACKEND=ob1`:** OB1 services must be running before starting the webapp. Start them first:
- **K8s (Docker Desktop):** ensure pods are up (`kubectl get pods -n openbrain`), then start the PostgreSQL port-forward: `kubectl port-forward svc/openbrain-db -n openbrain 5432:5432 &`
- **Docker Compose:** `docker compose -f integrations/ob1/docker-compose.yml up -d`

See [integrations/ob1/README.md](integrations/ob1/README.md) for full setup. Without OB1 services running, the webapp backend will fail to connect.

Or start the two processes separately:

```bash
# Terminal 1 — backend
cd webapp/backend && python3 -m uvicorn main:app --port 8000 --reload

# Terminal 2 — frontend
cd webapp/frontend && npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

### Tracker View

The default view (`/`) shows your full application pipeline in three collapsible sections: Active Applications, Phase D Samples, and Closed / Rejected.

**Search and filter:** A filter bar at the top of the page lets you search across all columns (company, role, status, notes) or narrow by Status, Profile, or Priority. Section counts update to show `filtered / total` when a filter is active.

**Navigating to an application:** Click any row with an application folder linked to open that application's detail view. Rows without a linked folder show a faint dot indicator.

### Application View

Clicking a tracker row opens the application folder view (`/applications/<folder>`). The header shows all tracker data for that application — company, role, profile, status, next action, and priority — refreshed from the live tracker on every visit.

The left sidebar lists all files in the folder. Click a file to view it in the main panel:
- **Markdown files** render with full formatting; click **Edit** to edit inline
- **PDF files** render in an iframe; click **Download** to save
- **Images** display inline
- **Other file types** show a download link

**Uploading files:** Drag and drop files anywhere onto the right panel, or click the **Upload** button in the sidebar footer. Both methods upload to the current application folder and immediately show the new file in the tree.

### Base Docs View

The Base Docs view (`/base-docs`) shows your source materials: resume PDFs, LinkedIn extracts, and any other reference documents you've uploaded. Use this view to add new source files before or during setup.

**Uploading:** Drag files onto the right panel, or use the **Upload to base docs** button in the sidebar.

### Setup Guide

The Setup Guide (`/setup`) provides a chat interface for working through the five setup phases (A through E). Each phase is a focused, short session with Claude — clicking a phase button starts a fresh conversation scoped to that phase, keeping context small and responses accurate.

| Phase | What it covers |
|---|---|
| A — Documents | Provide your resume PDF, LinkedIn URL, existing cover letters |
| B — Questionnaire | Fill in a pre-generated file with your location, compensation floor, deal-breakers, travel limits, and goals |
| C — Profiles | Build your experience fact sheet and content libraries |
| D — Career Advice | Role scoring, market demand analysis, target recommendations |
| E — Validation | Test profiles against sample JDs, generate a sample resume |

Phase completion status is shown in the sidebar under **Setup Status**. Once all phases are complete, the status bar shows all five as done.

### Command Launcher and Terminal

A collapsible panel at the bottom of every page gives you two tabs:

**Commands tab (default):** Run preset assistant commands with one click, or type any allowed command in the input box. Output streams in real time from a fresh Claude Code session. Supported commands: `/status`, `/memory read`, `/ingest <profile>`, `/linkedin-ingest`, `/audit <folder>`, `/apply "Co" "Role" "date"`.

**Terminal tab:** A full interactive terminal connected to a shell session opened in the repo directory. Type `claude` to start an interactive Claude Code session, run scripts, or use any shell command. Each terminal connection is a fresh session — close and reopen the tab to start a new one.

Drag the top border of the panel to resize it. Click the **▾/▴** button to collapse or expand.

### Documentation View

The Docs view (`/docs`) renders the system documentation in the browser — the same files in this repo (README, Quick Start, User Guide, Developer Guide, Workflow, Setup Guide). Use it as a quick reference while working in the app without switching to a file editor.

---

## Getting Set Up

This section covers the one-time setup process. If the system is already running and you have profiles, skip ahead to **Working With a Job Posting**.

### Prerequisites

- **Claude Code** — [desktop app](https://claude.ai/code) or `npm install -g @anthropic-ai/claude-code`
- **Anthropic API key** or Claude Code OAuth login (set during setup)

### Step 1 — Run the setup script

From the repo folder:

```bash
bash scripts/setup.sh
```

This is a one-time step. The script installs PDF tools (pandoc, poppler), detects your Playwright Python installation, and detects any cloud sync service you have installed (Google Drive, OneDrive, iCloud, Dropbox, Box), and creates your applicant directory there. Safe to re-run if you need to refresh configuration.

### Step 2 — Start the applicant setup conversation

Open Claude Code in the repo folder and say: **"Start the applicant setup process"** (or run `/setup`).

Claude leads you through five phases:

| Phase | What happens |
|---|---|
| A — Documents | You provide your source materials: LinkedIn URL or resume PDF, existing cover letters, any job postings you're already interested in |
| B — Questionnaire | Claude reads your uploaded documents and generates a pre-filled `applicant.md`. You open the file, fill in your preferences (location, compensation floor, deal-breakers, travel limits, goals), and reply **done** when finished |
| C — Profile generation | Claude builds your experience fact sheet, one profile per target role type, and an achievement library — you review and can edit anything |
| D — Career advice | Claude scores each profile (experience match, market demand, differentiation), suggests target roles, identifies skill gaps, and tells you which profile is most likely to land interviews fastest |
| E — Validation | Claude finds example JDs for each profile, runs them through the screening process, and generates a sample resume to confirm the content is ready |

**What you get at the end:** A verified fact sheet of your roles, a pre-built content library per profile, and career direction advice — everything the system needs to screen JDs and generate resumes for your entire search.

**How long it takes:** 1–2 sessions (60–90 minutes total).

**If you stop mid-setup:** `/setup B` resumes from Phase B; `/setup C` from Phase C; and so on.

---

## Finding Jobs Proactively

Instead of manually providing job postings one by one, you can run a search that fetches and screens a batch of Google Jobs listings for a given profile:

```
/ingest [profile]
```

This searches Google Jobs using the role-title queries defined for that profile (run as multiple sub-queries so Google returns more results per run), screens each result against your criteria, and saves fit jobs as application stubs in your applications folder. Each stub includes a job description summary, a verbatim JD file, and a `notes.md` with a fit assessment. Fit jobs are also added to your tracker with status "Found via search — pending review." After each run, a summary file is saved in your search directory listing every job screened — both matches and rejections — with scores and reasons, so you can review what was found and skipped.

**Requires:** `SEARCHAPI_KEY` set in `.env`. Add your SearchAPI key to that file before running. If the key is missing, the command will tell you and stop.

**Environment variables (all in `.env`):**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SEARCHAPI_KEY` | Yes | — | SearchAPI authentication key |
| `SEARCH_TARGET_FITS` | No | 10 | Target number of fit jobs per run |
| `SEARCH_BATCH_SIZE` | No | 10 | Max new jobs returned per API call |

**When to run:** Every few days per profile. The command deduplicates against jobs already seen so re-running is safe.

**After ingestion:** Review the stubs in your applications folder. For any job you want to pursue, open the folder and say "generate a resume for [company]" — this kicks off the standard resume workflow at Step 2 below.

**Examples:**
```
/ingest presales-se
/ingest presales-se --fits 5
/ingest presales-se --batch 20
/ingest presales-se --fits 5 --batch 20
```

If you leave out the profile name, the command lists available profiles and asks you to choose.

---

## Working With a Job Posting

This is the core workflow. Each step can happen at any time — you don't need to complete them all in one conversation.

### Step 1: Get a resume draft

Provide the job posting in any form:
- Paste the URL: `"Here's a posting I found: https://..."`
- Paste the text: just paste it in
- Upload the PDF: attach the file

The assistant screens the role for fit against your criteria. If it's not a match, it tells you why and stops. If it is a match, it generates a tailored resume and gives you a summary of why it fits. The screening includes an explicit fit assessment — location, travel, role type, compensation range — so you can make an informed call on borderline roles before any resume work begins.

**Example:**
> "I found this on LinkedIn — can you take a look?" [paste URL]

---

### Step 2: Review and refine the draft

Once you have a draft, work through it however you need to. You can do this across multiple conversations — the draft is saved. This is where most of the real work happens.

**Add a personal experience that's relevant:**
> "My 3 years at Southern Cross Bank on their core banking migration is relevant here — add it."

The assistant adds it to your experience record and updates the resume.

**Add or update an achievement:**
> "The Westbrook Financial project at ArcLight AI was specifically about compliance under the regional AI regulations — add that detail."

**Correct something that's wrong:**
> "The resume says I did hands-on messaging platform sales at StreamBridge — that's not right, I was in a governance role. Remove that."

Corrections are saved to your profile so they don't reappear in future resumes.

**Guide the structure:**
> "For this role, lead with my founding-architect work at DataStream — that's the differentiator."
> "This should be a 1-page resume — it's for a warm referral."

**If you've already submitted** a version of this resume and now want to revise it for a similar role, say so. The assistant creates a new version rather than overwriting the one you sent.

---

### Step 3: Check it's ready to submit

Before submitting on the company portal, run:

```
/audit [company-name]
```

This confirms everything is in order. If anything is missing, it tells you exactly what to fix.

**Example:**
```
/audit acme-ai-solutions-engineer
```

If you leave out the folder name, it lists your application folders and asks which one to check.

---

### Step 4: Record the submission

After you submit on the company's portal:

```
/apply "Company" "Role" "YYYY-MM-DD"
```

This logs the submission and sets a follow-up reminder for two weeks out. You can add the portal URL as a fourth argument.

**Examples:**
```
/apply "Acme AI" "Solutions Engineer" "2026-04-15"
/apply "Acme AI" "Solutions Engineer" "2026-04-15" "https://jobs.acme.ai/apply/123"
```

If the company has multiple active positions, the assistant will ask which one you're recording.

---

### Step 5: Follow up

Run `/status` to see which companies are past due for a follow-up. Contact them yourself (email or LinkedIn), then tell the assistant the outcome:

> "Acme AI came back — they want a phone screen next Thursday."

Your log updates automatically.

---

## Generating Application Content

Once you have a resume draft, ask for other materials at any point — they are generated from the same verified profile content and saved alongside the resume.

### Cover letter

> "Write a cover letter for this role."

The letter is generated in your voice and positioned to the specific company and role. It is saved as a PDF using the same pipeline as the resume. To refine:

> "The opening is too generic — make it specific to their AI governance platform work."
> "Keep it to one page."

### Application portal questions

Many portals ask open-ended questions before you submit. Paste the question:

> "The application asks: 'Describe a time you drove adoption of a new technology across a large organization.' Draft an answer."

Answers draw from EXPERIENCE-REFERENCE.md — factually grounded, not invented. Edit or tighten just as you would a resume bullet.

### Practical exercises

Some roles include a written exercise, case study, or take-home before an interview:

> "They sent a pre-work exercise — here it is. Help me plan my response."

The assistant helps you structure and argue your answer. It will not fabricate facts — it helps you present what you know effectively.

### Capturing what happened

Everything gets recorded in the application's `notes.md` automatically: the cover letter version used, questions answered, exercise approach. If you submitted something you drafted yourself, tell the assistant:

> "I ended up writing my own answer to the 'why us' question — here's what I sent."

It saves it so your record stays complete.

---

## Preparing for an Interview

Before any call or screen:

```
/interview [company]
/interview Flowmatic "technical screen"
```

You'll get: talking points tailored to this specific role and company, questions to ask, what not to bring up, and positioning strategy based on your profile.

If you don't specify the stage, the assistant uses the next upcoming stage from your application notes.

**Bringing in new context:**

> "I have my CloudMapper panel tomorrow. The recruiter mentioned they're dealing with a 200-system legacy integration problem — factor that in."

The assistant updates the brief with that context.

**Debriefing after an interview:**

> "Flowmatic passed on me — they wanted someone with hands-on orchestration internals experience, not SE motion."

This updates how the assistant positions you in future applications for similar roles.

**Tracking notes after a call:**

After any call, tell the assistant what happened — who you spoke with, what they emphasized, what they said about timeline:

> "I just finished the HM call with Flowmatic. She was focused on cross-functional buy-in, not technical depth. Timeline is two weeks to next round."

The assistant updates `notes.md` with a structured record. The next `/interview` prep automatically builds on it.

**How debrief feeds future applications:**

What you learn from rejections or late-stage losses updates how the assistant positions you going forward — without you needing to remember to carry it forward. This becomes a filter on similar roles and adjusts positioning language in future resumes for that role type.

---

## Updating Your Profile (Any Time)

Whenever something about you changes, just say it — no command needed:

- `"I prefer not to take roles requiring more than 25% travel."`
- `"I just wrapped up an AI governance project for a regional financial institution — it involved regulatory compliance under their local AI regulations."`
- `"I'm open to hybrid roles in the SF Bay Area now."`

Updates happen immediately and carry forward to every future application. They work in three directions:

- **Corrections** — when you correct something ("that bullet is wrong — I was in a governance role, not sales"), the correction saves to your profile and doesn't recur in future applications for similar roles.
- **Additions** — new experience or refined descriptions go into EXPERIENCE-REFERENCE.md and the relevant content libraries immediately, available to every future resume.
- **Preferences** — changes to what you want ("I'm open to hybrid in SF now") update `applicant.md` and apply to all future JD screening automatically.

The initial setup process also gives career direction advice and generates your target role profiles — you can revisit and update that positioning at any time as you learn what the market responds to.

---

## Making Manual Edits

If you edit your notes or experience files directly in a text editor, tell the assistant what changed:

> "I separated the DataStream product I built in 2007 from the later consulting work at the same company — they're two different things."

The assistant checks whether the change affects any active applications, updates your records, and flags anything that needs to be regenerated.

---

## Checking Your Pipeline

```
/status
```

A full snapshot: active applications by status, overdue follow-ups, priority companies, recent activity. Good for a weekly "where do things stand" check.

---

## Starting a Conversation

Context loads automatically at the start of every conversation — you'll see a brief confirmation of your identity, OB1/local mode, and DEV_MODE status. No command needed — just start talking. Run `/status` to see your active pipeline and overdue follow-ups.

To reload context mid-conversation (for example, after a status change):

```
/context
```

---

## Command Quick Reference

| Command | Parameters | What it does | When to use |
|---------|-----------|--------------|-------------|
| `/context` | none | Loads session context: identity, memory, and DEV_MODE status | Automatic at conversation start; use manually to refresh |
| `/status` | none | Pipeline snapshot with overdue follow-ups | Weekly check-in |
| `/ingest [profile] [--fits N] [--batch N]` | `profile` — profile slug (optional; lists profiles if omitted); `--fits N` — override target fit count; `--batch N` — override batch size | Search Google Jobs; screen and save fit jobs | Proactive discovery, ~every 3 days per profile |
| `/linkedin-ingest [--max-pages N]` | `--max-pages N` — cap pages fetched (optional; default: all) | Fetch LinkedIn job recommendations; screen against all active profiles; save fit jobs | Complement to `/ingest`; use whenever LinkedIn has fresh recommendations |
| `/audit [folder]` | `folder` — application folder name (optional; lists folders if omitted) | Confirms application is complete and ready to submit | Before submitting |
| `/apply "Co" "Role" "date" [url?]` | `company`, `role`, `date` (YYYY-MM-DD) required; `url` — portal URL, optional | Records submission; sets 14-day follow-up reminder | Right after submitting |
| `/interview [company] [stage?]` | `company` — partial name match required; `stage` — interview stage (optional; inferred from notes if omitted) | Interview brief: talking points, questions, positioning | Night before any call |
| `/memory [subcommand]` | No arg: list all; `read [name]`; `update`; `add [topic]` | Navigate and update the memory system | See subcommands below |
| `/setup [phase?]` | `phase` — A–E (optional; auto-detects current state if omitted) | First-time onboarding; phases A–E | Once at the beginning; `/setup A` to restart |

### /memory subcommands

| Form | What it does |
|------|--------------|
| `/memory` | List all memory files (process rules and applicant memory) |
| `/memory read [name]` | Read a specific memory file — partial name match OK (e.g., `/memory read domain` finds `feedback_domain_connection.md`) |
| `/memory update` | End-of-session sync: Claude asks what changed, updates the relevant file(s), and runs the memory sync script |
| `/memory add [topic]` | Create a new memory note — saved as `feedback_[topic].md` or `project_[topic].md` and added to the index |

---

## Troubleshooting

**"It can't fetch the job posting"**
Paste the text or upload the PDF directly. Some sites (LinkedIn, etc.) require a one-time login setup — if the assistant mentions this, it will give you the exact command to run.

**The audit failed**
Read the output — it lists exactly what's missing. The most common issues are:
- Resume PDF hasn't been generated yet
- Application notes are missing a section (usually company research or interview prep)
- The company hasn't been added to your active applications list yet

**"I submitted but forgot to run /apply"**
Run it now with the actual submission date. If there are multiple roles at the same company, the assistant will ask which one.

**"A resume correction I made keeps coming back"**
The correction may not have been saved to your profile. Tell the assistant: *"Update my profile so this correction sticks — [describe the change]."*

**"I want to restart the initial setup"**
```
/setup A
```
Forces a fresh start from Phase A. Your existing application files are not affected — only the onboarding state resets.
