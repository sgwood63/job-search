# Job Search Management System

An AI-assisted, structured system for finding, applying to, and tracking job opportunities — built to maintain authentic voice, factual accuracy, and consistent process across a multi-month search.

## How This System Works

Every application follows the same pipeline:

```
JD → Screen → Profile Match → Generate Resume → Review → Submit → Track → Interview Prep → Debrief
```

Each step is supported by AI assistance using short, task-scoped sessions. Context is loaded at session start from `CLAUDE.md` — not accumulated across long conversations.

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
│   └── cover-letter-override.css
│
└── scripts/                     # Utility scripts
    ├── new-application.sh       # Create application folder
    └── status-summary.sh        # Print tracker summary
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
├── applications/                # One folder per application
│   └── YYYY-MM-DD-company-role/
│       ├── job-description.md   # Full JD + extracted key info
│       ├── notes.md             # Analysis, interview prep, debrief
│       ├── [FirstName_LastName]_[Role]_[Company].md    # Resume (markdown source)
│       └── [FirstName_LastName]_[Role]_[Company].pdf   # Resume (final)
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
Shared stylesheet for PDF generation via pandoc + weasyprint. Use `one-page-override.css` for 1-page resumes.

---

## Google Drive Sync

After generating any document, sync the applicant directory to Google Drive:

```bash
source .env
rsync -av --exclude='node_modules' --exclude='_temp-*' \
  "$APPLICANT_DIR/" \
  "$GDRIVE_DIR/"
```

`$GDRIVE_DIR` is defined in `.env`. See [QUICK-START.md](QUICK-START.md) for setup.

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

## PDF Generation

Resumes are authored in Markdown and converted to PDF:

```bash
# Standard 2-page resume
pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=../../templates/resume.css

# 1-page variant
pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint \
  --css=../../templates/resume.css --css=../../templates/one-page-override.css

# Verify page count
pdfinfo [resume].pdf | grep Pages
```

---

## Principles

- **Factual accuracy**: Every claim must be verifiable. Source: `EXPERIENCE-REFERENCE.md`.
- **Authentic voice**: All materials sound like the person, not like an LLM.
- **Profile-based generation**: Resumes are generated from pre-compiled content libraries, not improvised per application.
- **Short sessions**: One task per session. Long sessions degrade through repeated context compression.
- **Organized tracking**: One tracker, updated immediately after every status change.
