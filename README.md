# Job Search Management System

An AI-assisted, structured system for finding, applying to, and tracking job opportunities — built to maintain authentic voice, factual accuracy, and consistent process across a multi-month search.

## How This System Works

Every application follows the same pipeline:

```
JD → Screen → Profile Match → Generate Resume → Review → Submit → Track → Interview Prep → Debrief
```

Each step is supported by AI assistance, with context loaded specifically for that step — not a single long conversation that accumulates and degrades.

---

## Directory Structure

```
Job-Search-2026/
├── README.md                    # This file
├── QUICK-START.md               # Setup guide for a new search
├── workflow.md                  # Detailed process documentation
├── application-tracker.md       # Master tracker (all applications)
│
├── profiles/                    # Career profiles (5 total)
│   ├── PROFILES-QUICK-REFERENCE.md   # Fast matching guide
│   ├── [profile-name].md             # Full profile strategy
│   └── [profile-name]-CONTENT.md     # Pre-compiled resume content library
│
├── base-documents/              # Source documents
│   ├── EXPERIENCE-REFERENCE.md  # Verified facts — canonical source of truth
│   ├── resume-content-guidance.md    # Resume construction standards
│   └── achievements-worksheet.md    # Raw achievements and metrics
│
├── applications/                # One folder per application
│   └── YYYY-MM-DD-company-role/
│       ├── job-description.md   # Full JD + extracted key info
│       ├── notes.md             # Analysis, interview prep, debrief
│       ├── Sherman_Wood_[Role]_[Company].md    # Resume (markdown source)
│       └── Sherman_Wood_[Role]_[Company].pdf   # Resume (final)
│
├── templates/                   # Shared assets
│   └── resume.css               # PDF generation stylesheet
│
├── memory/                      # Memory files (git-tracked mirror)
│   ├── MEMORY.md                # Master index
│   ├── EXPERIENCE-REFERENCE.md  # Mirror of base-documents version
│   ├── feedback_*.md            # Workflow and resume rules
│   └── user_*.md / project_*.md # User context and project state
│
└── scripts/                     # Utility scripts
```

---

## The Five Profiles

Applications are generated from one of five career profiles. Each has a full strategy document and a pre-compiled content library (no per-application PDF extraction needed):

| Profile | Target Roles |
|---|---|
| AI Governance & Risk Lead | AI risk, compliance, governance frameworks |
| Analytics Lead (Player-Coach) | BI/analytics leadership with hands-on delivery |
| Enterprise AI Platform Architect | AI platform implementation, technical pre-sales |
| Implementation/Customer Success Architect | Post-sales, onboarding, customer engineering |
| Pre-Sales Solutions Engineer | Technical SE, solutions consulting |

---

## Key Files

**`base-documents/EXPERIENCE-REFERENCE.md`**
Canonical source of verified experience facts. All resume generation draws from this. Never fabricate — if it's not here, ask before adding it.

**`profiles/PROFILES-QUICK-REFERENCE.md`**
One-page matching guide. Use this first when evaluating a new role.

**`profiles/[profile]-CONTENT.md`**
Pre-compiled resume bullets organized by profile. Eliminates per-application extraction from PDFs.

**`application-tracker.md`**
Single source of truth for all application statuses, next actions, and follow-up dates.

**`templates/resume.css`**
Shared stylesheet for PDF generation via pandoc + weasyprint.

---

## Storage

All files are maintained in two locations — keep both in sync:

- **Primary**: `/Users/shermanwood/Documents/Job-Search-2026/`
- **Google Drive**: `/Users/shermanwood/Library/CloudStorage/GoogleDrive-sgwood63@gmail.com/My Drive/Job Search 2026/`

After generating any document, sync immediately:
```bash
cp [local-file] "[gdrive-path]/[same-relative-path]"
```

---

## Memory System

Persistent memory lives in `~/.claude/projects/.../memory/` and is mirrored in `memory/` for git tracking. Key files:

- `MEMORY.md` — auto-loaded at session start; indexes all other memory
- `feedback_*.md` — accumulated rules about how to do the work
- `user_*.md` — user context (location, preferences, coding profile)
- `project_*.md` — project-level context (LatticeFlow departure, etc.)

After creating or updating any memory file, sync and commit:
```bash
cp ~/.claude/projects/-Users-shermanwood-Documents-Job-Search-2026/memory/*.md memory/
git -C /Users/shermanwood/Documents/Job-Search-2026 add memory/
git -C /Users/shermanwood/Documents/Job-Search-2026 commit -m "Update memory: [what changed]"
```

---

## PDF Generation

Resumes are authored in Markdown and converted to PDF:

```bash
pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=../../templates/resume.css
```

Target: 2 pages for enterprise/direct applications. Verify with `pdfinfo [file].pdf | grep Pages`.

---

## Principles

- **Factual accuracy**: Every claim in a resume must be verifiable. Source: `EXPERIENCE-REFERENCE.md`.
- **Authentic voice**: All materials sound like the person, not like an LLM.
- **Profile-based generation**: Resumes are generated from pre-compiled content libraries, not improvised per application.
- **No cover letters**: Not used in this search.
- **Organized tracking**: One tracker, updated immediately after every status change.
