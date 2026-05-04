# Developer Reference

## Contents

- [DEV_MODE — Modifying the System](#dev_mode--modifying-the-system)
- [Two-Repo Architecture](#two-repo-architecture)
- [Slash Command Architecture](#slash-command-architecture)
- [Hook System](#hook-system)
- [Memory System](#memory-system)
- [Customizing Workflow Rules](#customizing-workflow-rules)
- [JD Fetching](#jd-fetching)
- [PDF Generation](#pdf-generation)
- [Profile System](#profile-system)
- [Markdown Hygiene Rules](#markdown-hygiene-rules)
- [Settings Reference](#settings-reference)

---

This document covers system architecture, DEV_MODE operation, hook configuration, and command implementation details. For end-user workflows and command usage, see [USER-GUIDE.md](USER-GUIDE.md).

---

## DEV_MODE — Modifying the System

`$APP_DIR` is read-only by default. A `PreToolUse` hook (`scripts/check-dev-mode.sh`) intercepts every `Write` and `Edit` call to files inside `$APP_DIR` and blocks them when `DEV_MODE=false`.

**To enable APP_DIR editing:**
1. Open `.env` and set `DEV_MODE="true"` — no restart needed
2. Proceed with edits (if Claude is paused waiting, reply "continue")
3. When done, set `DEV_MODE="false"`

`DEV_MODE` is read on every tool call, so toggling it mid-session takes effect immediately.

If the hook blocks a write mid-session, Claude pauses and reports: which file was blocked, that DEV_MODE is off, and how to resume. Reply "continue" after enabling DEV_MODE and it retries.

---

## Two-Repo Architecture

| Directory | Purpose | Git-tracked | Writable by default |
|---|---|---|---|
| `$APP_DIR` (this repo) | Process, tooling, templates, memory | Yes | No (DEV_MODE gate) |
| `$APPLICANT_DIR` | Applicant data, applications, profiles, tracker | No | Yes |

Paths are defined in `.env` (gitignored). `$APPLICANT_DIR` is set during `bash scripts/setup.sh` to a local directory or a cloud sync service's managed folder (Google Drive, OneDrive, iCloud, Dropbox, or Box). The OS syncs automatically when a cloud service is chosen.

### `$APP_DIR` file tree

```
$APP_DIR/
├── CLAUDE.md                    # Auto-loaded session context — critical rules, triggers
├── README.md                    # System overview and requirements
├── QUICK-START.md               # Setup guide for new users
├── USER-GUIDE.md                # End-user workflow and command reference
├── DEVELOPER-README.md          # This file
├── workflow.md                  # Full pipeline documentation (JD → resume → submit)
├── applicant-setup.md           # Onboarding phases A–E + Phase F (profile maintenance)
│
├── .claude/
│   ├── settings.json            # Hooks, permissions, statusLine
│   └── commands/                # Slash command definitions (one .md per command)
│       ├── apply.md
│       ├── audit.md
│       ├── context.md
│       ├── interview.md
│       ├── memory.md
│       ├── setup.md
│       └── status.md
│
├── memory/                      # Process memory (git-tracked, auto-synced)
│   ├── MEMORY.md                # Index — loaded at session start
│   └── feedback_*.md            # Accumulated process rules
│
├── templates/
│   ├── resume.css               # Default PDF stylesheet (2-page)
│   ├── one-page-override.css    # Override for 1-page resumes
│   ├── cover-letter-override.css
│   ├── achievements-example.md
│   ├── PROFILES-README.md       # Guide for authoring profile files
│   └── scaffold/                # Stub files written by scripts/setup.sh
│       ├── applicant.md
│       ├── application-tracker.md
│       ├── base-documents/
│       ├── profiles/
│       └── memory/
│
└── scripts/
    ├── setup.sh                 # One-time setup
    ├── fetch-jd.py              # Playwright-based JD fetcher with auth support
    ├── generate-pdf.py          # PDF generation via Playwright
    ├── check-md-hygiene.sh      # Pre-commit hook: no personal names or hard-coded paths
    ├── check-dev-mode.sh        # PreToolUse hook: blocks APP_DIR writes when DEV_MODE=false
    ├── install-hooks.sh         # Installs git hooks into .git/hooks/
    ├── sync-memory.sh           # Commits memory/ and copies to ~/.claude/
    ├── README.md                # Script documentation
    └── README-linkedin-extractors.md
```

### `$APPLICANT_DIR` file tree

```
$APPLICANT_DIR/
├── applicant.md                 # Contact info, job criteria, location, deal-breakers
├── application-tracker.md       # Master tracker (all applications, statuses, next actions)
├── career-advice.md             # Career analysis from Phase D (fit scores, target roles, gaps)
├── applicant-maintenance.md     # Log of profile updates made during the search
│
├── profiles/
│   ├── PROFILES-QUICK-REFERENCE.md   # Fast matching guide (used by Haiku screening agent)
│   ├── EXPERIENCE-REFERENCE.md       # Verified role history, education, certifications
│   ├── role-achievements.md          # Achievement set scored against active profiles
│   ├── [profile-name].md             # Full profile strategy document
│   └── [profile-name]-CONTENT.md     # Pre-compiled resume content library
│
├── base-documents/              # Source documents (uploaded PDFs, interview notes)
│   └── resume-content-guidance.md   # Setup-only — not read during normal workflow
│
├── .auth/                       # Playwright session cookies for login-walled job sites
│   └── <domain>.json            # Per-domain; never committed; expires periodically
│
├── applications/                # One folder per application
│   └── YYYY-MM-DD-company-role/
│       ├── job-description.md         # Processed JD + extracted key info
│       ├── jd-<company>-<role>.md     # Original JD full text (URL/pasted source)
│       ├── jd-<company>-<role>.pdf    # Original JD (PDF source)
│       ├── notes.md                   # Analysis, interview prep, process, debrief
│       ├── Name_Role.md               # Resume (markdown source)
│       └── Name_Role.pdf              # Resume (PDF)
│
└── memory/
    ├── APPLICANT-MEMORY.md          # Extended applicant context (loaded at session start)
    └── applicant-setup-status.md    # Current search state — updated at session end
```

---

## Slash Command Architecture

Commands are defined as Markdown files in `$APP_DIR/.claude/commands/`. Claude Code auto-loads them — the filename (without `.md`) becomes the slash command name.

| File | Command |
|------|---------|
| `commands/setup.md` | `/setup` |
| `commands/context.md` | `/context` |
| `commands/status.md` | `/status` |
| `commands/audit.md` | `/audit` |
| `commands/apply.md` | `/apply` |
| `commands/interview.md` | `/interview` |
| `commands/memory.md` | `/memory` |

**To add a command:** Create a new `.md` file in `.claude/commands/`. The file's content is the instruction Claude receives when the command is invoked. Takes effect at the next session — no restart needed.

**To modify a command:** Edit the `.md` file directly (requires `DEV_MODE=true`). Same timing.

Commands are git-tracked and contain no PII — available on any machine that clones this repo.

---

## Hook System

Hooks are configured in `.claude/settings.json` under the `hooks` key.

### PreToolUse — DEV_MODE gate

Runs `scripts/check-dev-mode.sh` before every `Write` or `Edit` tool call. If the target path is inside `$APP_DIR` and `DEV_MODE=false`, the hook exits non-zero and blocks the operation.

The script reads `DEV_MODE` from `.env` on every invocation — toggling the value mid-session takes effect immediately.

### Stop — memory sync

Runs `scripts/sync-memory.sh` after every Claude response. The script:
1. Checks for uncommitted changes in `$APP_DIR/memory/`
2. If any exist, commits them with an auto-generated message
3. Copies all `memory/*.md` files to `~/.claude/projects/.../memory/` so the live session picks them up on the next message

To add or modify hooks, edit the `hooks` section in `.claude/settings.json` (requires `DEV_MODE=true`).

---

## Memory System

Two memory locations serve different purposes:

| Location | Scope | Sync |
|---|---|---|
| `$APP_DIR/memory/` | Process rules, feedback, references | Auto via Stop hook; git-tracked |
| `$APPLICANT_DIR/memory/` | Applicant-specific context | Updated in real-time; local only |

`MEMORY.md` is the index — loaded at session start and used to decide which files to consult. `feedback_*.md` files hold the detailed rules.

### File format

```markdown
---
name: Short name
description: One-line description used to assess relevance in future sessions
type: feedback | project | user | reference
---

[body — for feedback/project types: lead with the rule, then **Why:** and **How to apply:** lines]
```

### Manual sync

```bash
bash "$APP_DIR/scripts/sync-memory.sh"
```

Use this after editing memory files outside a Claude session (e.g., directly in a text editor).

---

## Customizing Workflow Rules

Process rules live in three locations with different scopes:

| Location | Scope | When to use |
|---|---|---|
| `CLAUDE.md` | Always-loaded; applies every session | Critical rules and workflow triggers that must be visible at session start |
| `memory/feedback_*.md` | Loaded on demand; indexed via `MEMORY.md` | Detailed rules, feedback, and preferences — preferred for most rule changes (keeps `CLAUDE.md` lean) |
| `$APPLICANT_DIR/memory/` | Applicant-specific; local only | Role preferences, deal-breakers, search state |

**To add or update a rule:**
1. Edit the relevant `memory/feedback_*.md` file (or `CLAUDE.md` for session-critical rules). Requires `DEV_MODE=true`.
2. If you edited `CLAUDE.md` or a `memory/` file, run the sync script so the live session picks up the change:
   ```bash
   bash "$APP_DIR/scripts/sync-memory.sh"
   ```
   The Stop hook runs this automatically after every Claude response — manual sync is only needed when editing outside a session.

**`MEMORY.md`** is the index for all `memory/` files. Add a one-line pointer entry whenever you create a new `feedback_*.md` file.

---

## JD Fetching

`scripts/fetch-jd.py` uses Playwright to fetch job description pages. Called automatically by Claude during the JD workflow.

**Primary path:** Claude tries WebFetch first. On login wall or failure, falls back to the Playwright script.

**Exit codes:**
- `0` — success
- `1` — navigation error → ask user to paste JD text
- `2` — auth required or expired → show user the `--setup` command from stderr

**Auth setup for login-walled sites:**

```bash
source "$APP_DIR/.env"
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --setup 'https://www.linkedin.com/jobs/view/123'
```

Opens the default browser → log in → press Enter. The script scans Firefox profiles for session cookies. Falls back to manual DevTools entry (`F12 → Application → Cookies`, copy the session cookie name and value).

Auth is saved to `$APPLICANT_DIR/.auth/<domain>.json`. Re-run `--setup` or `--import` when exit code 2 is returned.

> **Note:** Chromium-family browsers (Chrome, Edge, Brave, Arc) encrypt cookies via the OS keychain, which requires system-level access and is not reliably available to external tools. Use Firefox or the manual DevTools fallback.

**Import cookies from Firefox without opening a browser:**

```bash
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --import linkedin.com
```

**Save full page text as markdown alongside the processed job-description.md:**

```bash
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out "$FOLDER/jd-company-role.md" "<url>"
```

---

## PDF Generation

Resumes are authored in Markdown and converted to PDF via pandoc → Playwright (headless Chromium). Never use `--print-to-pdf` via Chrome directly — Chrome adds filename/filepath to headers/footers.

```bash
source "$APP_DIR/.env"

# Standard 2-page resume
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages

# 1-page variant
pandoc "$RESUME_MD" -o "$RESUME_HTML" \
  --css="$APP_DIR/templates/resume.css" \
  --css="$APP_DIR/templates/one-page-override.css" \
  --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

`$PLAYWRIGHT_PYTHON` is set by `scripts/setup.sh` and stored in `.env`. Always source `.env` before generating — never probe for the Python path at generation time.

---

## Profile System

Each profile represents a target role type. Two files per profile:

| File | Purpose |
|------|---------|
| `[profile-name].md` | Strategy document — how to position for this role type |
| `[profile-name]-CONTENT.md` | Pre-compiled resume content library — source for all bullet generation |

Supporting files:
- `EXPERIENCE-REFERENCE.md` — canonical verified role history, education, certifications. All resume generation draws from this only.
- `PROFILES-QUICK-REFERENCE.md` — fast matching guide used by the Haiku screening agent
- `role-achievements.md` — achievement set scored against active profiles
- `base-documents/` — setup input only; not read during the normal workflow

See `templates/PROFILES-README.md` for authoring guidance.

---

## Markdown Hygiene Rules

Every `.md` file committed to `$APP_DIR` must:
- Use "the applicant" or "the user" — never the applicant's name
- Not contain hard-coded absolute paths

Enforced by `scripts/check-md-hygiene.sh` (pre-commit hook). The hook reads `APPLICANT_NAME` from `.env` for the name check. Install once with `bash scripts/install-hooks.sh`.

---

## Settings Reference

**`.env`** (gitignored):

| Variable | Set by | Purpose |
|---|---|---|
| `APP_DIR` | `setup.sh` | Absolute path to this repo |
| `APPLICANT_DIR` | `setup.sh` | Absolute path to applicant data directory |
| `APPLICANT_NAME` | `setup.sh` | Used by `check-md-hygiene.sh` for name-leak detection |
| `PLAYWRIGHT_PYTHON` | `setup.sh` | Python interpreter with Playwright installed |
| `DEV_MODE` | Manual | `"true"` to allow APP_DIR writes; `"false"` to block |

**`.claude/settings.json`**:

| Field | Purpose |
|---|---|
| `hooks.PreToolUse` | Runs `check-dev-mode.sh` before Write/Edit tool calls |
| `hooks.Stop` | Runs `sync-memory.sh` after every Claude response |
| `permissions` | Tool allowlist — Bash commands and MCP tools that run without prompting |
| `env.statusLine` | Text shown in the Claude Code status bar |
