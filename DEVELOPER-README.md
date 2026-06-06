# Developer Reference

## Contents

- [DEV_MODE — Modifying the System](#dev_mode--modifying-the-system)
- [Two-Repo Architecture](#two-repo-architecture)
- [OB1 Kubernetes Deployment](#ob1-kubernetes-deployment)
- [Webapp](#webapp)
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

`$APP_DIR` is read-only by default. A `PreToolUse` hook (`scripts/check-dev-mode.sh`) intercepts every `Write` and `Edit` call to files inside `$APP_DIR` and blocks them when `DEV_MODE=false`. The same hook also blocks direct writes to `$APPLICANT_DIR` when `DATA_BACKEND=ob1`, enforcing MCP-only access to applicant data.

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
│       ├── applicant.md         # Phase B questionnaire template — pre-populated from base-documents, edited by applicant
│       ├── application-tracker.md
│       ├── base-documents/
│       ├── profiles/
│       └── memory/
│
├── scripts/
│   ├── setup.sh                 # One-time setup
│   ├── fetch-jd.py              # Playwright-based JD fetcher with auth support
│   ├── generate-pdf.py          # PDF generation via Playwright
│   ├── k8s-apply-env.sh         # Creates k8s Secrets/ConfigMaps + generates .mcp.json (OB1)
│   ├── migrate-to-ob1.py        # Migrates local APPLICANT_DIR to OB1 (MinIO + Postgres)
│   ├── check-md-hygiene.sh      # Pre-commit hook: no personal names or hard-coded paths
│   ├── check-dev-mode.sh        # PreToolUse hook: blocks APP_DIR writes (DEV_MODE) + APPLICANT_DIR writes (OB1)
│   ├── install-hooks.sh         # Installs git hooks into .git/hooks/
│   ├── sync-memory.sh           # Commits memory/ and copies to ~/.claude/
│   ├── status-line.sh           # Dynamic status bar for Claude Code VS Code extension
│   ├── generate-setup-status.sh # Auto-generates applicant-setup-status.md (Stop hook)
│   ├── README.md                # Script documentation
│   └── README-linkedin-extractors.md
│
└── integrations/
    └── ob1/
        ├── README.md                # Full K8s deployment guide
        ├── job-search-schema.sql    # 9 js_* Postgres tables
        ├── job-search-tools.ts      # 17 MCP tool implementations (Deno)
        ├── job-search-server.ts     # MCP HTTP server entry point (Deno/Hono)
        ├── Dockerfile               # Builds job-search-mcp image
        ├── docker-compose.yml       # OB1 data services (postgres + minio)
        ├── k8s/                     # Kubernetes manifests
        └── tests/
            └── test-deployment.sh  # 19-assertion deployment verification suite
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

## OB1 Kubernetes Deployment

For a user-facing comparison of all deployment modes and end-to-end setup instructions (local, Docker Compose, K8s, OB1 default), see [DEPLOYMENT.md](DEPLOYMENT.md).

OB1 is an optional replacement for the local `$APPLICANT_DIR` + cloud sync path. Instead of flat files synced via Google Drive/OneDrive/etc., all applicant content lives in a local Kubernetes cluster:

- **MinIO** — object store for all files (notes, JDs, PDFs, profiles)
- **PostgreSQL** (`js_*` tables) — structured state (pipeline, contacts, interviews, search runs)
- **pgvector** — semantic search over all content via OB1's `thoughts` table

**Prerequisite:** A local clone of the OB1 repo is required (`$OB1_REPO_PATH` in `.env`) to build the `openbrain-mcp-server:latest` Docker image used by the OB1 StatefulSet. The `job-search-mcp` image is built from this repo and has no external dependency.

### Architecture (3 pods + nginx Ingress)

| Component | What it is | URL |
|---|---|---|
| `openbrain-0` | StatefulSet: PostgreSQL + OB1 MCP sidecar | `http://localhost/ob1/mcp` |
| `job-search-mcp` | Deployment: Deno/Hono server, 17 MCP tools | `http://localhost/job-search/mcp` |
| `minio` | Deployment: S3-compatible object store | `http://localhost/minio` (console) / `localhost:30900` (S3) |
| nginx Ingress | Routes `/ob1`, `/job-search`, `/minio` | Port 80 — no per-session port-forwarding |

All services are permanently accessible through nginx Ingress once deployed. PostgreSQL is cluster-internal; use `kubectl port-forward svc/openbrain-db -n openbrain 5432:5432` on demand (required for `migrate-to-ob1.py`).

### MCP transport

Both servers use the **Streamable HTTP** transport. Claude Code requires:
- `"type": "http"` in `.mcp.json`
- URL pointing to the `/mcp` endpoint (e.g. `http://localhost/ob1/mcp`)
- `x-brain-key` auth header

`.mcp.json` is gitignored and auto-generated by `bash scripts/k8s-apply-env.sh` from `.env` values.

### Session-start protocol

When `DATA_BACKEND=ob1` in `.env`, Claude Code verifies that `mcp__job-search__*` and `mcp__open-brain__*` appear in the deferred tools list at session start. If they do not appear — hard stop, do not fall back to local files or cloud sync. Tell the user to restart Claude Code. See `memory/feedback_ob1_integration.md`.

### Data persistence (Docker Desktop)

Postgres data and MinIO objects are stored in hostPath volumes at `/var/openbrain/db` and `/var/openbrain/minio` inside the Docker Desktop VM. These survive pod restarts but are wiped on full cluster teardown. Clean teardown requires a privileged pod to delete contents before the namespace is deleted.

### Key scripts

| Script | Purpose |
|---|---|
| `scripts/k8s-apply-env.sh` | Creates all k8s Secrets/ConfigMaps from `.env`; generates `.mcp.json` |
| `scripts/migrate-to-ob1.py` | One-time migration of local APPLICANT_DIR to MinIO + Postgres |
| `integrations/ob1/tests/test-deployment.sh` | 19-assertion deployment verification suite |

**Full deployment guide:** [integrations/ob1/README.md](integrations/ob1/README.md)

---

## Webapp

For deployment options (local launch, Docker Compose, K8s) and a comparison of all modes, see [DEPLOYMENT.md](DEPLOYMENT.md).

The browser webapp (`webapp/`) provides a React + FastAPI UI for browsing and editing applicant data. It supports both `local` and `ob1` data modes (selected by `DATA_BACKEND` in `.env`).

See [webapp/README.md](webapp/README.md) for prerequisites, configuration, launch instructions, API endpoints, and test suites.

### Containerization

Two Docker images are built from the repo root:

| Image | Dockerfile | Purpose |
|-------|-----------|---------|
| `job-search-webapp:latest` | `webapp/Dockerfile` | FastAPI backend + compiled React frontend |
| `job-search-claude-runner:latest` | `webapp/runner/Dockerfile` | Claude subprocess sidecar |

**Multi-stage build** (`webapp/Dockerfile`): Stage 1 (`node:20-slim`) builds the React frontend and installs the `claude` binary via npm. Stage 2 (`python:3.11-slim`) copies the binary and runs uvicorn. Both stages use Debian so the binary is glibc-compatible.

**Claude runner** (`webapp/runner/`): A thin FastAPI sidecar that wraps `claude` subprocess calls. The webapp routes to it when `CLAUDE_RUNNER_URL` is set (always set in K8s via `webapp-configmap`; unset in docker-compose, where the webapp uses its built-in binary). The runner exposes `POST /run` — accepts `{args, cwd, message}`, streams NDJSON back verbatim. This separates the subprocess boundary without changing the wire protocol. The runner binary lives at `/runner/runner.py` (not `/app`) so an emptyDir mount at `/app` can't overlay it.

### K8s webapp deployment

Deploys alongside the existing OB1 services in the `openbrain` namespace. The pod runs an init container + two app containers:

- **init-app-dir**: copies `/app` from the webapp image into a shared `app-dir` emptyDir so both the webapp and the runner see identical project files (CLAUDE.md, memory/, scripts/, etc.)
- **webapp**: mounts `app-dir` at `/app`; entrypoint writes `/app/.env` and `/app/.mcp.json` from env vars, then starts uvicorn
- **claude-runner**: mounts `app-dir` at `/app` so the `claude` subprocess finds CLAUDE.md and .mcp.json; runner binary lives at `/runner/` to avoid mount overlay

```bash
docker build -f webapp/Dockerfile -t job-search-webapp:latest .
docker build -f webapp/runner/Dockerfile webapp/runner/ -t job-search-claude-runner:latest
bash scripts/k8s-apply-env.sh          # creates webapp-secret
kubectl apply -f integrations/ob1/k8s/webapp-configmap.yml
kubectl apply -f integrations/ob1/k8s/webapp.yml
kubectl apply -f integrations/ob1/k8s/webapp-nodeport.yml
```

Access at `http://localhost:30800`. Requires `ANTHROPIC_API_DEPLOYMENT_KEY` in `.env` (no OAuth in containers) for chat sessions.

### docker-compose

Two compose files, combine with `-f` flags:

| File | Contents |
|------|---------|
| `webapp/docker-compose.yml` | Webapp service only |
| `integrations/ob1/docker-compose.yml` | PostgreSQL + MinIO + openbrain MCP + job-search-mcp |

```bash
# Webapp only (local mode)
docker compose -f webapp/docker-compose.yml up

# Full OB1 stack (webapp + all 4 OB1 services)
docker compose \
  -f webapp/docker-compose.yml \
  -f integrations/ob1/docker-compose.yml up
```

For OB1 compose mode, set these in `.env` before running (values differ from K8s defaults):
```
DATA_BACKEND=ob1
DB_HOST=postgres
MINIO_ENDPOINT=minio:9000
OB1_MCP_URL=http://localhost:8080
JOB_SEARCH_MCP_URL=http://localhost:8081
```
Then re-run `bash scripts/k8s-apply-env.sh` to regenerate `.mcp.json` with the compose-mode URLs.

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
| `commands/ingest.md` | `/ingest` |
| `commands/linkedin-ingest.md` | `/linkedin-ingest` |

**To add a command:** Create a new `.md` file in `.claude/commands/`. The file's content is the instruction Claude receives when the command is invoked. Takes effect at the next session — no restart needed.

**To modify a command:** Edit the `.md` file directly (requires `DEV_MODE=true`). Same timing.

Commands are git-tracked and contain no PII — available on any machine that clones this repo.

---

## Hook System

Hooks are configured in `.claude/settings.json` under the `hooks` key.

### PreToolUse — DEV_MODE gate

Runs `scripts/check-dev-mode.sh` before every `Write` or `Edit` tool call. Two rules enforced:
- If target path is inside `$APP_DIR` and `DEV_MODE=false` → blocked (set `DEV_MODE=true` to enable)
- If target path is inside `$APPLICANT_DIR` and `DATA_BACKEND=ob1` → blocked (use `upload_file()` MCP tool instead)

The script reads `DEV_MODE` from `.env` on every invocation — toggling the value mid-session takes effect immediately.

### Stop — memory sync

Runs `scripts/sync-memory.sh` after every Claude response. The script:
1. Checks for uncommitted changes in `$APP_DIR/memory/`
2. If any exist, commits them with an auto-generated message
3. Copies all `memory/*.md` files to `~/.claude/projects/.../memory/` so the live session picks them up on the next message

### PostToolUse — write summary

Runs `scripts/summarize-write.sh` after every `Write` tool call. Outputs a one-line impact summary for significant file writes (e.g., resume written, notes updated). Suppresses output for routine or system files.

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
- `3` — job posting closed or no longer available → skip; folder not created

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

**Save full page text as markdown to a file:**

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
| `SEARCHAPI_KEY` | Manual | SearchAPI key required for `/ingest` |
| `SEARCH_TARGET_FITS` | Manual | Target fit count per `/ingest` run (default 10) |
| `SEARCH_BATCH_SIZE` | Manual | Max new jobs per API call in `/ingest` (default 10) |
| `DATA_BACKEND` | Manual | `"local"` (default) or `"ob1"` — selects backend for both the webapp and Claude Code terminal sessions |
| `OB1_REPO_PATH` | Manual | Path to local OB1 repo clone; required to build `openbrain-mcp-server:latest` |
| `OB1_MCP_URL` | Manual | Base URL for OB1 MCP server (e.g. `http://localhost/ob1`) |
| `OB1_MCP_KEY` | Manual | Auth key for OB1 MCP server (`x-brain-key` header) |
| `JOB_SEARCH_MCP_URL` | Manual | Base URL for job-search MCP server (e.g. `http://localhost/job-search`) |
| `JOB_SEARCH_MCP_KEY` | Manual | Auth key for job-search MCP server (`x-brain-key` header) |
| `MINIO_ENDPOINT` | Manual | MinIO S3 API address (e.g. `localhost:30900`) |
| `MINIO_ACCESS_KEY` | Manual | MinIO access key |
| `MINIO_SECRET_KEY` | Manual | MinIO secret key |
| `MINIO_BUCKET` | Manual | MinIO bucket name (e.g. `job-search`) |
| `DB_PASSWORD` | Manual | PostgreSQL password for OB1 shared database |

**`.claude/settings.json`**:

| Field | Purpose |
|---|---|
| `hooks.PreToolUse` | Runs `check-dev-mode.sh` before Write/Edit tool calls |
| `hooks.Stop` | Runs `sync-memory.sh` after every Claude response |
| `permissions` | Tool allowlist — Bash commands and MCP tools that run without prompting |
| `statusLine` | Dynamic status bar generated by `scripts/status-line.sh` — shows live active count, pending-review count, and nearest follow-up date |
