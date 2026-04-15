# Job Search Assistant — CLAUDE.md

This is a Streamlit + Anthropic API application that supports Sherman Wood's job search process. It replaces the free-form Claude Code chat approach with scoped, sub-process sessions that load only the relevant context for each task.

---

## What This App Does

Each sub-process (screen JD, generate resume, review, interview prep, debrief, memory update) is a focused conversation with the Anthropic API. Context is assembled fresh per session from specific files. No single long conversation accumulates — each session is short and scoped to one task.

---

## Directory Layout

```
app/                          ← this directory (Streamlit app)
├── CLAUDE.md                 ← this file
├── app.py                    ← Streamlit entry point
├── engine.py                 ← context loader, API caller, file writer
├── config.yaml               ← paths and model defaults
├── .env                      ← API key (gitignored)
├── .env.example              ← template
├── requirements.txt
└── processes/                ← one YAML per sub-process
    ├── screen-jd.yaml
    ├── generate-resume.yaml
    ├── review-resume.yaml
    ├── interview-prep.yaml
    ├── debrief.yaml
    └── update-memory.yaml
```

The app reads and writes into the data directory (parent of this folder):

```
../                           ← Job-Search-2026/ (data root)
├── applications/             ← one folder per application
├── base-documents/           ← EXPERIENCE-REFERENCE.md, resume-content-guidance.md
├── profiles/                 ← profile .md and -CONTENT.md files
├── memory/                   ← git-tracked memory mirror
├── templates/resume.css      ← PDF stylesheet
└── application-tracker.md   ← master tracker
```

Google Drive mirror path is in `config.yaml`.

---

## Process YAML Format

Each process definition in `processes/` has this structure:

```yaml
name: process-id
display_name: Human-readable name
model: claude-haiku-4-5-20251001   # or claude-sonnet-4-6

base_context:                      # always loaded, relative to data root
  - memory/MEMORY.md
  - profiles/PROFILES-QUICK-REFERENCE.md

optional_context:                  # user can add at session start
  - application-tracker.md

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

**Critical**: `system_prompt` contains behavioral rules. Factual context (who Sherman is, his experience) comes from the loaded files. Never hardcode facts into system prompts — they live in MEMORY.md and EXPERIENCE-REFERENCE.md.

---

## Feedback / Process Evolution

When a user gives corrective or confirmatory guidance during a session, it should be appended to the relevant process YAML's `guidance:` field. This is how processes evolve without code changes.

Triggers to watch for:
- Corrections: "don't do that", "wrong", "that's not right", "never"
- Rules: "always", "remember to", "make sure you"
- Confirmations of non-obvious choices: "yes exactly", "keep doing that"

When detected, surface a "Save as guidance?" prompt. On confirmation, append to `processes/[current-process].yaml` under `guidance:`.

The `guidance:` field is prepended to the system prompt at session start. It accumulates over time and represents the evolved behavior of that process.

---

## Context Loading

`engine.py` assembles context by:
1. Reading each file listed in `base_context` (relative to data root)
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

---

## File Writes

The app writes to the data directory (`../`). Key write operations:

| Operation | Path |
|---|---|
| Create application folder | `../applications/YYYY-MM-DD-company-role/` |
| Save JD | `../applications/.../job-description.md` |
| Save notes | `../applications/.../notes.md` |
| Save resume (markdown) | `../applications/.../Sherman_Wood_[Role]_[Company].md` |
| Generate PDF | `../applications/.../Sherman_Wood_[Role]_[Company].pdf` |
| Update tracker | `../application-tracker.md` |
| Update memory | `../memory/*.md` (and `~/.claude/projects/.../memory/`) |

After every write, sync to Google Drive (path in `config.yaml`).

PDF generation: `pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=../templates/resume.css`

---

## Key Constraints

- **Never fabricate**: No invented companies, titles, achievements, metrics, tools, or certifications. Source of truth is `EXPERIENCE-REFERENCE.md`.
- **No cover letters**: Not used in this search.
- **Resume header**: Always "San Francisco Bay Area" — never "Oakland, CA".
- **Contact info**: sgwood63@gmail.com | 415-516-4894 | linkedin.com/in/shermanwood | github.com/sgwood63
- **Role ordering**: Strict reverse chronological. Earlier Career subsection for all pre-2010 roles. Section heading is always "RELEVANT EXPERIENCE".
- **Role attribution**: Jasper4Salesforce → Founding Architect (2005–2010). js-docker → Director Pre-Sales (2012–2020). Never swap.
- **Resume length**: 2 pages default for enterprise/direct; 1 page for pre-sales SE / networking.

---

## Running the App

```bash
cd app/
pip install -r requirements.txt
cp .env.example .env         # add your API key
streamlit run app.py
```
