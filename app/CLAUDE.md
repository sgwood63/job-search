# Job Search Assistant — CLAUDE.md

This is a Streamlit + Anthropic API application that supports a job search process. It replaces the free-form Claude Code chat approach with scoped, sub-process sessions that load only the relevant context for each task.

---

## What This App Does

Each sub-process (screen JD, generate resume, review, interview prep, debrief, memory update) is a focused conversation with the Anthropic API. Context is assembled fresh per session from specific files. No single long conversation accumulates — each session is short and scoped to one task.

---

## Two-Directory Architecture

**App source tree** (this repo, git-tracked):
```
$SOURCE_DIRECTORY/
├── app/                          ← this directory
│   ├── CLAUDE.md                 ← this file
│   ├── app.py                    ← Streamlit entry point
│   ├── engine.py                 ← context loader, API caller, file writer
│   ├── config.yaml               ← paths and model defaults
│   ├── .env                      ← API key + APPLICANT_DIR (gitignored)
│   ├── .env.example              ← template
│   ├── requirements.txt
│   └── processes/                ← one YAML per sub-process
│       ├── screen-jd.yaml
│       ├── generate-resume.yaml
│       ├── review-resume.yaml
│       ├── interview-prep.yaml
│       ├── debrief.yaml
│       └── update-memory.yaml
├── templates/
│   └── resume.css                ← PDF stylesheet (app-owned)
└── memory/                       ← app-process rules (git-tracked)
    ├── MEMORY.md
    └── feedback_*.md / project_*.md
```

**Applicant data directory** (`$APPLICANT_DIR`, NOT git-tracked):
```
$APPLICANT_DIR/
├── applicant.md                  ← contact info, criteria, preferences
├── application-tracker.md        ← master tracker
├── profiles/                     ← career profiles + CONTENT.md libraries
├── applications/                 ← one folder per job application
├── base-documents/               ← EXPERIENCE-REFERENCE.md and source docs
└── memory/                       ← applicant-specific memory files
    ├── APPLICANT-MEMORY.md       ← index
    └── *.md
```

`APPLICANT_DIR` is set in `app/.env`. The engine reads it at startup and validates it exists.

---

## Process YAML Format

Each process definition in `processes/` has this structure:

```yaml
name: process-id
display_name: Human-readable name
model: claude-haiku-4-5-20251001   # or claude-sonnet-4-6

base_context:                      # files to load at session start
  - app:memory/MEMORY.md           # app: prefix → resolved from $SOURCE_DIRECTORY/
  - applicant:applicant.md         # applicant: prefix → resolved from APPLICANT_DIR
  - applicant:profiles/PROFILES-QUICK-REFERENCE.md

optional_context:                  # user can add at session start
  - applicant:application-tracker.md

system_prompt: |
  Behavioral instructions for this process.
  Context files are injected after this.

guidance: |
  # Accumulated Guidance
  (feedback from sessions is appended here)

outputs:                           # declared save actions for UI buttons
  - save_notes
  - update_tracker
```

**Path prefix convention:**
- `app:` → resolved relative to `$SOURCE_DIRECTORY/` (app source root)
- `applicant:` → resolved relative to `$APPLICANT_DIR`
- No prefix → legacy; treated as `applicant:` for backward compatibility

**Critical**: `system_prompt` contains behavioral rules. Factual context (experience facts, applicant preferences) comes from the loaded files — never hardcode personal facts into system prompts.

---

## Feedback / Process Evolution

When a user gives corrective or confirmatory guidance during a session, it should be appended to the relevant process YAML's `guidance:` field. This is how processes evolve without code changes.

Triggers to watch for:
- Corrections: "don't do that", "wrong", "that's not right", "never"
- Rules: "always", "remember to", "make sure you"
- Confirmations of non-obvious choices: "yes exactly", "keep doing that"

When detected, surface a "Save as guidance?" prompt. On confirmation, append to `processes/[current-process].yaml` under `guidance:`.

---

## Context Loading

`engine.py` assembles context by:
1. Reading each file listed in `base_context`, resolving `app:` vs `applicant:` prefixes
2. Adding any user-attached files for this session
3. Concatenating into a single context block appended to the system prompt
4. For application-specific sessions: loading the relevant application folder's files

File reading is always from disk at session start — never cached between sessions.

---

## API Usage

- Model selection is per-process (Haiku for screening/debrief, Sonnet for generation/review)
- API key from environment: `ANTHROPIC_API_KEY`
- No streaming required initially — response at once is fine
- Max tokens: 8192 default; override per process if needed
- Temperature: 0 for factual/structured tasks, 0.3 for generative tasks (resumes, prep notes)
- Prompt caching: enabled on system prompt (ephemeral cache_control)

---

## File Writes

The app writes applicant data to `$APPLICANT_DIR`. Key write operations:

| Operation | Path |
|---|---|
| Create application folder | `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/` |
| Save JD | `$APPLICANT_DIR/applications/.../job-description.md` |
| Save notes | `$APPLICANT_DIR/applications/.../notes.md` |
| Save resume (markdown) | `$APPLICANT_DIR/applications/.../Sherman_Wood_[Role]_[Company].md` |
| Generate PDF | `$APPLICANT_DIR/applications/.../Sherman_Wood_[Role]_[Company].pdf` |
| Update tracker | `$APPLICANT_DIR/application-tracker.md` |
| Update applicant memory | `$APPLICANT_DIR/memory/*.md` |
| Update app-process memory | `$SOURCE_DIRECTORY/memory/*.md` (git-tracked) |

After every write, sync to Google Drive (path in `config.yaml` under `applicant.gdrive_root`).

PDF generation: `pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=../templates/resume.css`

---

## Memory Write Paths (update-memory process)

The `write_file` tool distinguishes two memory locations:

| Tool path | Writes to | Git-tracked? |
|---|---|---|
| `memory/FILENAME.md` | `$SOURCE_DIRECTORY/memory/` | Yes |
| `applicant-memory/FILENAME.md` | `$APPLICANT_DIR/memory/` | No |
| `base-documents/EXPERIENCE-REFERENCE.md` | `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md` | No |
| `applications/{folder}/FILENAME.md` | `$APPLICANT_DIR/applications/{folder}/` | No |

App-process memory is committed to git via the Commit button in the Update Memory process.

---

## Key Constraints

- **Never fabricate**: No invented companies, titles, achievements, metrics, tools, or certifications. Source of truth is `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md`.
- **No cover letters**: Not used in this search.
- **Resume header location**: Always "San Francisco Bay Area" (see `$APPLICANT_DIR/memory/feedback_resume_location.md`).
- **Contact info**: In `$APPLICANT_DIR/applicant.md` — never hardcode in code or process YAMLs.
- **Role ordering**: Strict reverse chronological (see `memory/feedback_role_ordering.md`).
- **Resume length**: 2 pages default.

---

## Running the App

```bash
cd app/
pip install -r requirements.txt
cp .env.example .env         # add ANTHROPIC_API_KEY and APPLICANT_DIR
streamlit run app.py
```
