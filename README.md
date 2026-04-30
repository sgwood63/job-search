# Job Search Management System

An AI-assisted, structured system for finding, applying to, and tracking job opportunities — built to maintain authentic voice, factual accuracy, and consistent process across a multi-month search.

## How This System Works

Every application follows the same pipeline:

```
JD → Screen → Profile Match → Generate Resume → Review → Submit → Track → Interview Prep → Debrief
```

Each step is supported by AI assistance using short, task-scoped sessions. Context is loaded at session start from `CLAUDE.md` — not accumulated across long conversations.

---

## Requirements

| Requirement | Notes |
|---|---|
| [Claude Code](https://claude.ai/code) | The CLI that runs all AI-assisted steps. Install via the desktop app or `npm install -g @anthropic-ai/claude-code`. |
| Anthropic API key | Required for automated workflows. Get one at [console.anthropic.com](https://console.anthropic.com). Set during `scripts/setup.sh`. |
| Claude Haiku | Used for JD screening (fast, low-cost). Requires API access. |
| Claude Sonnet | Used for resume and document generation (quality). Requires API access. |
| pandoc + Playwright + poppler | PDF generation. Installed/detected by `scripts/setup.sh`. |

This system is built around Claude Code's session model: `CLAUDE.md` is auto-loaded at the start of every session, giving the AI its full context without relying on conversation history.

---

## Two-Repo Structure

This system uses two directories with distinct purposes:

| Directory | Purpose | Git-tracked |
|---|---|---|
| `$APP_DIR` (this repo) | Process, tooling, templates, memory | Yes |
| `$APPLICANT_DIR` | Applicant data, applications, profiles, tracker | No |

Paths are defined in `.env` — see [QUICK-START.md](QUICK-START.md) for setup.

Applicant data is kept out of git to protect PII and keep the process repo clean.

---

## Process Repo — `$APP_DIR`

```
$APP_DIR/
├── CLAUDE.md                    # Auto-loaded session context (rules + workflow)
├── README.md                    # This file
├── QUICK-START.md               # Setup guide
├── workflow.md                  # Detailed process documentation
│
├── memory/                      # Process memory (git-tracked)
│   ├── MEMORY.md                # Master index
│   └── feedback_*.md            # Accumulated rules
│
├── templates/                   # Shared assets
│   ├── resume.css               # Default PDF stylesheet (2-page)
│   ├── one-page-override.css    # Override for 1-page resumes
│   ├── cover-letter-override.css
│   ├── achievements-example.md  # Reference example for writing achievements
│   ├── PROFILES-README.md       # Guide for authoring profile files
│   └── scaffold/                # Stub files written by scripts/setup.sh
│       ├── applicant.md
│       ├── application-tracker.md
│       ├── base-documents/
│       ├── profiles/
│       └── memory/
│
└── scripts/                     # Utility scripts
    ├── setup.sh                 # One-time setup: auth, deps, applicant dir, .env
    └── README.md                # LinkedIn job URL collector notes
```

---

## Applicant Repo — `$APPLICANT_DIR`

```
$APPLICANT_DIR/
├── applicant.md                 # Contact info, job criteria, location preferences
├── application-tracker.md       # Master tracker (all applications)
│
├── profiles/                    # Career profiles (5 total)
│   ├── PROFILES-QUICK-REFERENCE.md   # Fast matching guide
│   ├── [profile-name].md             # Full profile strategy
│   └── [profile-name]-CONTENT.md     # Pre-compiled resume content library
│
├── base-documents/              # Source documents
│   ├── EXPERIENCE-REFERENCE.md  # Verified facts — canonical source of truth
│   ├── resume-content-guidance.md
│   └── achievements-worksheet.md
│
├── .auth/                       # Playwright session cookies for login-walled job sites
│   └── linkedin.com.json        # Applicant-specific; never committed; expires periodically
│
├── applications/                # One folder per application
│   └── YYYY-MM-DD-company-role/
│       ├── job-description.md         # Processed JD + extracted key info
│       ├── jd-<company>-<role>.md     # Original JD full text (for reference)
│       ├── notes.md                   # Analysis, interview prep, debrief
│       ├── [FirstName_LastName]_[Role].md    # Resume (markdown source)
│       └── [FirstName_LastName]_[Role].pdf   # Resume (final)
│
└── memory/                      # Applicant-specific memory (not in process repo)
    └── APPLICANT-MEMORY.md
```

---

## Profiles

Applications are generated from one of several career profiles defined in `$APPLICANT_DIR/profiles/`. Each profile has a full strategy document and a pre-compiled content library (no per-application PDF extraction needed). The number and type of profiles are applicant-specific.

---

## Key Files

**`$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md`**
Canonical source of verified experience facts. All resume generation draws from this. Never fabricate — if it's not here, ask before adding it.

**`$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`**
One-page matching guide. Use this first when evaluating a new role.

**`$APPLICANT_DIR/application-tracker.md`**
Single source of truth for all application statuses, next actions, and follow-up dates.

**`CLAUDE.md`**
Auto-loaded by Claude Code at session start. Contains all workflow rules, resume standards, and process rules. Edit this (and `memory/MEMORY.md`) to change how the AI behaves.

**`templates/resume.css`**
Shared stylesheet for PDF generation via pandoc → Playwright. Use `one-page-override.css` for 1-page resumes.

---

## File Storage and Sync

`$APPLICANT_DIR` is set during `bash scripts/setup.sh` to a local directory or a cloud sync service's managed folder (Google Drive, OneDrive, iCloud, Dropbox, or Box). When a cloud service is chosen, the OS syncs files automatically — no manual step needed.

---

## Memory and Session Context

**`CLAUDE.md`** is the primary session context — loaded automatically by Claude Code at the start of every session. It contains the complete workflow, rules, and resume standards.

**`memory/`** contains supporting files (feedback rules, reference paths) that are indexed in `CLAUDE.md`. Edit these to update specific rules; then update `CLAUDE.md` if the change affects auto-loaded behavior.

After editing any memory file, commit from the repo:

```bash
git add memory/ CLAUDE.md
git commit -m "Update memory: [what changed]"
```

---

## JD Fetching

`scripts/fetch-jd.py` fetches job description pages using Playwright. It is called automatically by Claude during the JD workflow.

- **Public sites** (e.g. company careers pages): fetched with no setup needed
- **Login-walled sites** (e.g. LinkedIn): require a one-time auth setup per domain:
  ```bash
  source "$APP_DIR/.env"
  "$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --setup 'https://www.linkedin.com/jobs/view/123'
  ```
  Opens a browser → log in → press Enter → auth saved to `$APPLICANT_DIR/.auth/linkedin.com.json`

**Cookie expiry:** Session cookies expire periodically. When a previously working domain returns exit code 2 (auth-expired), either re-run `--setup` or refresh the cookie manually — for LinkedIn, copy the `li_at` cookie value from Chrome DevTools (Application → Cookies → linkedin.com) and overwrite the auth file.

**Save JD text:** Use `--md-out` to save the full page text as markdown alongside the processed `job-description.md`:
```bash
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out "$FOLDER/jd-company-role.md" "<url>"
```

---

## PDF Generation

Resumes are authored in Markdown and converted to PDF:

```bash
source "$APP_DIR/.env"

# Standard 2-page resume
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages

# 1-page variant — add one-page-override.css to the pandoc command
pandoc "$RESUME_MD" -o "$RESUME_HTML" \
  --css="$APP_DIR/templates/resume.css" \
  --css="$APP_DIR/templates/one-page-override.css" \
  --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

`$PLAYWRIGHT_PYTHON` is set by `scripts/setup.sh` and stored in `.env`. Always source `.env` before generating PDFs — never probe for the Python path at generation time.

---

## Principles

- **Factual accuracy**: Every claim must be verifiable. Source: `EXPERIENCE-REFERENCE.md`.
- **Authentic voice**: All materials sound like the person, not like an LLM.
- **Profile-based generation**: Resumes are generated from pre-compiled content libraries, not improvised per application.
- **Short sessions**: One task per session. Long sessions degrade through repeated context compression.
- **Organized tracking**: One tracker, updated immediately after every status change.
