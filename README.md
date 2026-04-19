# Job Search Management System

An AI-assisted, structured system for finding, applying to, and tracking job opportunities — built to maintain authentic voice, factual accuracy, and consistent process across a multi-month search.

## How This System Works

Every application follows the same pipeline:

```
JD → Screen → Profile Match → Generate Resume → Review → Submit → Track → Interview Prep → Debrief
```

Each step is a focused AI session with only the relevant context loaded. No single long conversation — each session is short and scoped to one task.

---

## Repository Structure (App Source Tree)

This repo contains app source code and process definitions only. Applicant data lives outside at `$APPLICANT_DIR`.

```
$SOURCE_DIRECTORY/
├── README.md                    # This file
├── QUICK-START.md               # Setup guide
├── workflow.md                  # Detailed process documentation
│
├── templates/                   # Shared assets
│   └── resume.css               # PDF generation stylesheet
│
├── memory/                      # App-process rules (git-tracked)
│   ├── MEMORY.md                # Process rules master index
│   ├── feedback_*.md            # Workflow and resume process rules
│   └── project_*.md             # App project context
│
└── app/                         # Streamlit application
    ├── CLAUDE.md                # App development guide
    ├── app.py                   # Streamlit entry point
    ├── engine.py                # Context loader, API caller, file writer
    ├── config.yaml              # Paths and model defaults
    ├── .env                     # API key + APPLICANT_DIR (gitignored)
    ├── .env.example             # Template
    ├── requirements.txt
    └── processes/               # One YAML per sub-process
        ├── screen-jd.yaml
        ├── generate-resume.yaml
        ├── review-resume.yaml
        ├── interview-prep.yaml
        ├── debrief.yaml
        └── update-memory.yaml
```

---

## Applicant Data Structure (`$APPLICANT_DIR`)

All applicant-specific files live outside this repo, referenced via the `APPLICANT_DIR` environment variable:

```
$APPLICANT_DIR/
├── applicant.md                 # Contact info, job criteria, preferences
├── application-tracker.md      # Master tracker (all applications)
│
├── profiles/                   # Career profiles
│   ├── PROFILES-QUICK-REFERENCE.md   # Fast matching guide
│   ├── [profile-name].md             # Full profile strategy
│   └── [profile-name]-CONTENT.md     # Pre-compiled resume content library
│
├── base-documents/             # Source documents
│   ├── EXPERIENCE-REFERENCE.md # Verified facts — canonical source of truth
│   └── resume-content-guidance.md   # Resume construction standards
│
├── applications/               # One folder per application
│   └── YYYY-MM-DD-company-role/
│       ├── job-description.md  # Full JD + extracted key info
│       ├── notes.md            # Analysis, interview prep, debrief
│       └── [Resume].md / .pdf  # Resume (markdown source + final PDF)
│
└── memory/                     # Applicant-specific memory (not git-tracked)
    ├── APPLICANT-MEMORY.md     # Index
    └── *.md                    # Individual memory files
```

---

## Key Files

**`$APPLICANT_DIR/applicant.md`**
Contact info, location preferences, job criteria, hard rules (no defense roles, no cover letters).

**`$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md`**
Canonical source of verified experience facts. All resume generation draws from this. Never fabricate — if it's not here, ask before adding it.

**`$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`**
One-page matching guide. Use this first when evaluating a new role.

**`$APPLICANT_DIR/profiles/[profile]-CONTENT.md`**
Pre-compiled resume bullets organized by profile. Eliminates per-application extraction from PDFs.

**`$APPLICANT_DIR/application-tracker.md`**
Single source of truth for all application statuses, next actions, and follow-up dates.

**`templates/resume.css`**
Shared stylesheet for PDF generation via pandoc + weasyprint. Lives in app source tree.

---

## Storage

Applicant data is maintained in two locations — keep both in sync:

- **Primary**: `$APPLICANT_DIR` (configured in `app/.env`)
- **Google Drive**: configured in `app/config.yaml` under `applicant.gdrive_root`

After generating any document:
```bash
# App handles sync automatically; or manually:
cp [local-file] "[gdrive-path]/[same-relative-path]"
```

---

## Memory System

Memory is split into two categories:

**App-process memory** (git-tracked in `memory/`):
- Process rules, workflow guidance, resume construction standards
- Accumulated process feedback that applies to any applicant

**Applicant memory** (`$APPLICANT_DIR/memory/`):
- Experience clarifications, personal preferences, personal context
- NOT committed to git

Both are mirrored to Claude's auto-memory at `~/.claude/projects/.../memory/` for session use.

---

## PDF Generation

```bash
pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=templates/resume.css
```

Target: 2 pages for enterprise/direct applications. Verify with `pdfinfo [file].pdf | grep Pages`.

---

## Running the App

```bash
cd app/
pip install -r requirements.txt
cp .env.example .env         # add ANTHROPIC_API_KEY and APPLICANT_DIR
streamlit run app.py
```
