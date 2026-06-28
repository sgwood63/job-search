# Developer Reference

## Contents

- [DEV_MODE — Modifying the System](#dev_mode--modifying-the-system)
- [Two-Repo Architecture](#two-repo-architecture)
- [OB1 Kubernetes Deployment](#ob1-kubernetes-deployment)
- [Backup & Restore (OB1)](#backup--restore-ob1)
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
├── workflow.md                  # Pointer to the versioned workflow/skill entries (kept for references)
├── applicant-setup.md           # Onboarding phases A–E + Phase F (profile maintenance)
│
├── docs/
│   ├── ob1-merge-spec.md        # OB1 consolidation spec — single-server merge, 34 tools, BigInt fix (implemented)
│   ├── webapp-parity-spec.md    # Webapp parity spec — Thoughts UI, /ob1/rest/* proxy routes (in progress)
│   ├── architecture/            # Design PDF, approved plan, implementation record, phase 3/4 roadmap
│   ├── ob1-search-runs/         # Search runs API spec, deploy checklist, backfill procedure
│   ├── ob1-intelligent-access/  # Context-optimization roadmap (chunking design, schema changes)
│   └── observability/           # Langfuse integration guide (trace schema, dashboard, OB1 proxy)
│
├── skills/                      # Versioned generative procedures (source of truth)
│   ├── registry.yaml            # Index of all skills/policies/workflows
│   ├── README.md                # Format spec, version resolution, draft → promote flow
│   └── <name>/                  # skill.yaml manifest + immutable v1.md, v2.md… (+ draft.md while revising)
├── policies/                    # Versioned cross-cutting rules (factuality, evidence-grounding,
│                                #   company-descriptors, storage-routing) — same layout as skills/
├── workflows/                   # Versioned multi-step orchestrations (create-application,
│                                #   prepare-interview, process-jd, search-jobs,
│                                #   search-jobs-linkedin) — invoke skills by name
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
│   └── feedback_*.md            # Session/tooling rules; migrated entries are pointer stubs into skills/
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
│   ├── ob1-backup.sh            # Point-in-time encrypted backup of OB1 → cloud sync folder
│   ├── ob1-restore.sh           # Restore OB1 from encrypted backup archive
│   ├── check-md-hygiene.sh      # Pre-commit hook: no personal names or hard-coded paths
│   ├── check-dev-mode.sh        # PreToolUse hook: blocks APP_DIR writes (DEV_MODE) + APPLICANT_DIR writes (OB1)
│   ├── install-hooks.sh         # Installs git hooks into .git/hooks/
│   ├── sync-memory.sh           # Commits memory/ and copies to ~/.claude/
│   ├── status-line.sh           # Dynamic status bar for Claude Code VS Code extension
│   ├── generate-setup-status.sh # Auto-generates applicant-setup-status.md (Stop hook)
│   ├── langfuse_cc_hook.py      # Stop hook: posts session turn telemetry to Langfuse (silent no-op if keys absent)
│   ├── launch-chrome-debug.sh  # Launches Chrome with CDP remote debugging (port 9222) for LinkedIn live-browser sessions
│   ├── README.md                # Script documentation
│   ├── README-linkedin-extractors.md
│   └── tests/
│       ├── conftest.py              # Shared fixtures; bootstraps APP_DIR before collection
│       ├── test_fetch_scripts.py    # Unit/mock tests for fetch-jd.py and fetch-linkedin-recs.py (no network)
│       ├── test_fetch_e2e.py        # E2E tests (-m e2e / e2e_jd / e2e_public); public tier is CI-safe
│       ├── check-test-urls.py       # Maintenance: checks non-stable URLs in data/public-jd-urls.json for expiry
│       └── data/
│           └── public-jd-urls.json  # Real ATS URLs used by e2e_public tests; non-stable entries expire (exit 3)
│
└── integrations/
    └── ob1/
        ├── README.md                # Full K8s deployment guide
        ├── full-schema.sql          # Authoritative 3-layer schema (thoughts+pgvector, entities+edges, js_*) — use for fresh deploys
        ├── job-search-schema.sql    # Layer 3 only (js_* tables) — idempotent; use full-schema.sql for fresh deploys
        ├── job-search-tools.ts      # 34 MCP tool implementations (31 job-search + 3 OB1-compat absorbed tools)
        ├── job-search-server.ts     # MCP HTTP server entry point (Deno/Hono)
        ├── Dockerfile               # Builds job-search-mcp image
        ├── docker-compose.yml       # OB1 data services (postgres + minio)
        ├── k8s/                     # Kubernetes manifests
        └── tests/
            ├── test-deployment.sh       # 30-assertion deployment verification suite (bash)
            ├── test-ob1-tools.ts        # 9 unit tests for absorbed OB1-compat tools (search, fetch, thought_stats; BigInt safety) (Deno)
            ├── test-knowledge-graph.ts  # 11 unit tests for Phase 3 knowledge graph core functions (Deno)
            ├── test-search-thoughts.ts  # 15 unit tests for search_thoughts/list_thoughts tools (Deno)
            └── test-chunking.ts         # 15 unit tests for HTML/DOCX/PDF extraction + markdown chunking (Deno)
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
│       ├── notes-index.md             # PRIMARY: header block + OB1 thought key registry (v4+ model)
│       ├── notes.md                   # GENERATED VIEW: rendered from OB1 thoughts by application-summary skill
│       ├── job-description.md         # Processed JD + extracted key info
│       ├── jd-<company>-<role>.md     # Original JD full text (URL/pasted source)
│       ├── jd-<company>-<role>.pdf    # Original JD (PDF source)
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
- **PostgreSQL** (`js_*` tables) — structured state (pipeline, contacts, interviews, search runs, ingested positions)
- **pgvector** — semantic search over all content via OB1's `thoughts` table

No OB1 repo required — the `openbrain-0` StatefulSet runs only PostgreSQL (`postgres:16` from Docker Hub); the OB1 MCP sidecar and langfuse-proxy have been removed. The `job-search-mcp` image (built from this repo) contains all 34 tools.

### Architecture (3 pods + nginx Ingress)

| Component | What it is | URL |
|---|---|---|
| `openbrain-0` | StatefulSet: PostgreSQL only (1/1 container) | Port 5432 — cluster-internal via `openbrain-db` Service |
| `job-search-mcp` | Deployment: Deno/Hono server — 34 MCP tools + REST API (`/api/v2/*` + `/ob1/rest/*`) — all job-search and OB1-compat tools in a single server | `http://localhost/job-search/mcp` · `http://localhost/job-search/api/v2/*` |
| `minio` | Deployment: S3-compatible object store | ClusterIP only — not externally accessible; use `kubectl port-forward svc/minio -n openbrain 9000:9000` for admin access |
| nginx Ingress | Routes `/job-search`, `/minio` | Port 80 — no per-session port-forwarding |

All services are permanently accessible through nginx Ingress once deployed. PostgreSQL is cluster-internal; use `kubectl port-forward svc/openbrain-db -n openbrain 5432:5432` on demand (required for `migrate-to-ob1.py` only — the webapp no longer accesses Postgres directly).

**Single write path:** In OB1 mode, both Claude Code (via MCP tools) and the webapp (via REST) write through the same `*Core()` functions in `job-search-tools.ts`. This ensures every file write triggers the same 4-step embedding transaction (S3 write → thought embedding → metadata extraction → Postgres upsert) regardless of which client initiates it. The webapp drops all direct Postgres and MinIO credentials — it needs only `JOB_SEARCH_REST_URL` and `JOB_SEARCH_MCP_KEY`.

### MCP transport

The single server uses the **Streamable HTTP** transport. Claude Code requires:
- `"type": "http"` in `.mcp.json`
- URL pointing to the `/mcp` endpoint (e.g. `http://localhost/job-search/mcp`)
- `x-brain-key` auth header

`.mcp.json` is gitignored and auto-generated by `bash scripts/k8s-apply-env.sh` from `.env` values. It contains a single `job-search` entry.

If nginx Ingress is not up, connect directly via port-forward:
```bash
kubectl port-forward -n openbrain svc/job-search-mcp 8001:8001 &
```

### Session-start protocol

When `DATA_BACKEND=ob1` in `.env`, Claude Code verifies that `mcp__job_search__*` tools appear in the deferred tools list at session start. The `mcp__open_brain__*` server has been removed — `mcp__job_search__*` is the only server. If job-search tools are absent — hard stop, do not fall back to local files or cloud sync. Tell the user to restart Claude Code. See `policies/storage-routing/` (pinned version).

### Data persistence (Docker Desktop)

Postgres data and MinIO objects are stored in hostPath volumes at `/var/openbrain/db` and `/var/openbrain/minio` inside the Docker Desktop VM. These survive pod restarts but are wiped on full cluster teardown. Clean teardown requires a privileged pod to delete contents before the namespace is deleted.

### Key scripts

| Script | Purpose |
|---|---|
| `scripts/start-ob1.sh` | Start OB1 docker-compose services (sources both `.env` and `.env.services`) |
| `scripts/k8s-apply-env.sh` | Creates all k8s Secrets/ConfigMaps from `.env` + `.env.services`; generates `.mcp.json`; hardens ingress-nginx probe timeouts |
| `scripts/migrate-to-ob1.py` | One-time migration of local APPLICANT_DIR to MinIO + Postgres |
| `scripts/ob1-backup.sh` | Point-in-time encrypted backup of PostgreSQL + MinIO → cloud sync folder |
| `scripts/ob1-restore.sh` | Restore PostgreSQL + MinIO from encrypted backup; requires K8s services Running |
| `integrations/ob1/scripts/backfill_search_runs.py` | One-time backfill of search run history and ingested-position records from existing summary `.md` files into `js_search_runs` / `js_ingested_positions`; idempotent — safe to re-run |
| `integrations/ob1/tests/test-deployment.sh` | Deployment verification suite — namespace, secrets, pods, PostgreSQL schema, MinIO bucket, Ingress, single MCP server (34 tools), OB1-compat tool checks, webapp health, and functional MCP round-trips. Run: `source .env && bash integrations/ob1/tests/test-deployment.sh` |
| `integrations/ob1/tests/test-ob1-tools.ts` | 9 Deno unit tests for the absorbed OB1-compat tools (`registerSearchTool`, `registerFetchTool`, `registerThoughtStatsTool`) — verifies search/fetch shapes, BigInt safety (`id::text AS id`), and COUNT::int cast. All DB I/O mocked. Run: `cd integrations/ob1 && deno test --no-check --allow-env --allow-sys tests/test-ob1-tools.ts` |
| `integrations/ob1/tests/test-knowledge-graph.ts` | 11 Deno unit tests for Phase 3 knowledge graph core functions (`createKnowledgeEdgeCore`, `getEntityNeighborsCore`, `traverseKnowledgeGraphCore`) — all DB I/O mocked, no live services needed. **Requires Deno** (`curl -fsSL https://deno.land/install.sh \| sh`). Run: `cd integrations/ob1 && deno test --allow-env --allow-sys tests/test-knowledge-graph.ts` |
| `integrations/ob1/tests/test-search-thoughts.ts` | 15 Deno unit tests for `listThoughtsCore`, `registerSearchThoughtsTool`, and `registerListThoughtsTool` — all DB I/O mocked, no live services needed. Run: `cd integrations/ob1 && deno test --allow-env --allow-sys tests/test-search-thoughts.ts` |
| `integrations/ob1/tests/test-chunking.ts` | 15 Deno unit tests for Phase 2 chunking core functions (`chunkMarkdown`, `searchChunksSemanticCore`) — covers H2 splitting, preamble handling, oversized sections, headerless paragraph splitting, single-newline fallback, similarity threshold, and SQL parameter passing. All DB I/O mocked. Run: `cd integrations/ob1 && deno test --allow-env --allow-sys --no-check tests/test-chunking.ts` |

**Full deployment guide:** [integrations/ob1/README.md](integrations/ob1/README.md)

See also: [`docs/ob1-search-runs/`](docs/ob1-search-runs/) (API spec, deploy checklist, backfill procedure) and [`docs/ob1-intelligent-access/`](docs/ob1-intelligent-access/) (context-optimization roadmap — Phases 1–3 complete; Phase 4 (OB1 audit events + learning loop) deferred).

---

## Backup & Restore (OB1)

`scripts/ob1-backup.sh` and `scripts/ob1-restore.sh` provide point-in-time snapshots of all OB1 state: the PostgreSQL database (`openbrain`) and the MinIO object store (`job-search` bucket). The backup archive also captures `.env.services` (credentials). Targets the Kubernetes deployment only.

### What is backed up

| Component | Tool | Method |
|---|---|---|
| PostgreSQL (`openbrain` DB) | `pg_dump` inside the pod | `kubectl exec` — no local `pg_dump` required |
| MinIO bucket (`job-search`) | `mc mirror` | `kubectl port-forward` to ClusterIP service (killed after use) |
| `.env.services` | `cp` | Included so a restore is self-contained |
| `.env` | `cp` | Included for reference |

### Prerequisites

```bash
brew install minio/stable/mc   # MinIO client — only new dependency
# kubectl and openssl are pre-installed on macOS
```

### Passphrase

Both scripts resolve the encryption passphrase in this order — the first match wins:

| Source | How |
|---|---|
| `BACKUP_PASSPHRASE` env var | `BACKUP_PASSPHRASE=secret bash scripts/ob1-backup.sh` |
| `BACKUP_PASSPHRASE_FILE` env var | `BACKUP_PASSPHRASE_FILE=~/.ob1-pass bash scripts/ob1-backup.sh` |
| macOS Keychain | Stored by a previous interactive run (see below) |
| Interactive prompt | Type or paste, then press Enter — input is hidden |

**Store in Keychain (recommended — avoids typing it each run):**

```bash
security add-generic-password -a ob1-backup -s ob1-backup-passphrase -w
# (prompted for the passphrase)
```

**Store in a file** (useful for scripts or 1Password CLI):

```bash
# Write passphrase to a file, lock it down
echo "your-passphrase" > ~/.ob1-passphrase
chmod 600 ~/.ob1-passphrase

# Use it
BACKUP_PASSPHRASE_FILE=~/.ob1-passphrase bash scripts/ob1-backup.sh

# Or pipe from 1Password CLI
BACKUP_PASSPHRASE=$(op read "op://Personal/ob1-backup/password") bash scripts/ob1-backup.sh
```

### Running a backup

```bash
source "$APP_DIR/.env"
bash scripts/ob1-backup.sh
```

Output: `<cloud-sync-dir>/ob1-backups/ob1-backup-YYYY-MM-DD-HHMMSS.tar.gz.enc`

The destination is derived automatically from `APPLICANT_DIR` in `.env` — the `ob1-backups/` folder is created as a sibling of `job-applications/` inside your cloud sync root (Google Drive, OneDrive, etc.). Override with:

```bash
OB1_BACKUP_DEST=/custom/path bash scripts/ob1-backup.sh
```

### Restoring from a backup

```bash
source "$APP_DIR/.env"
bash scripts/ob1-restore.sh "/path/to/ob1-backup-YYYY-MM-DD-HHMMSS.tar.gz.enc"
```

The script decrypts the archive, shows the MANIFEST (timestamp, object counts), requires you to type `YES` to confirm, then:
1. Drops and recreates the `openbrain` database
2. Wipes and re-populates the MinIO bucket
3. Runs a post-restore verification (row counts + MinIO object count vs. MANIFEST)

**Assumption:** K8s services (`openbrain-0`, `minio`) are already deployed and Running. Only data is restored — manifests and container images are not touched.

After restore, run the deployment test suite to confirm end-to-end health:

```bash
source .env && bash integrations/ob1/tests/test-deployment.sh
```

### Archive format

```
ob1-backup-YYYY-MM-DD-HHMMSS.tar.gz.enc
└── ob1-backup-YYYY-MM-DD-HHMMSS/          (AES-256-CBC, PBKDF2, 100k iterations)
    ├── MANIFEST.txt                        (counts for post-restore verification)
    ├── postgres/
    │   └── openbrain.sql                   (pg_dump plain-text format)
    ├── minio/
    │   └── job-search/                     (full bucket contents, mirrored)
    │       ├── applicant.md
    │       ├── applications/...
    │       └── ...
    └── config/
        ├── env.services                    (storage credentials)
        └── env                             (Claude Code session config)
```

### Key scripts

| Script | Purpose |
|---|---|
| `scripts/ob1-backup.sh` | Create a timestamped encrypted backup and move it to the cloud sync folder |
| `scripts/ob1-restore.sh` | Decrypt an archive, restore PostgreSQL + MinIO, verify counts |

---

## Webapp

For deployment options (local launch, Docker Compose, K8s) and a comparison of all modes, see [DEPLOYMENT.md](DEPLOYMENT.md).

The browser webapp (`webapp/`) provides a React + FastAPI UI for browsing and editing applicant data. It supports both `local` and `ob1` data modes (selected by `DATA_BACKEND` in `.env`).

**Views:** Tracker (`/`), Application detail, Base Docs, Setup Guide, Command Launcher, Docs, Search (ingest run history), and — in OB1 mode — **Thoughts** (`/thoughts`): browse and semantic-search all captured knowledge graph artifacts (portal Q&A, emails, notes, interview prep) with per-thought metadata and a detail view showing related thoughts.

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

### Environment file split

Two files, both gitignored, serve different audiences:

| File | Contents | Who sources it |
|------|----------|----------------|
| `.env` | Claude CLI config: paths, MCP keys, search API, `DEV_MODE` | Claude Code shell session |
| `.env.services` | Storage credentials: MinIO, Postgres, LLM API keys, `ANTHROPIC_API_DEPLOYMENT_KEY` | `scripts/start-ob1.sh`, `scripts/k8s-apply-env.sh` |

**Why the split:** Claude's shell inherits every exported var. Keeping storage credentials out of `.env` means Claude (and any Bash tool calls it makes) cannot reach MinIO, Postgres, or LLM APIs directly — all applicant data must flow through the OB1 MCP tools. See [policies/storage-routing/](policies/storage-routing/) (pinned version).

Copy both example files to get started:
```bash
cp .env.example .env
cp .env.services.example .env.services
# Fill in both files with your values
```

### docker-compose

Two compose files, combine with `-f` flags:

| File | Contents |
|------|---------|
| `webapp/docker-compose.yml` | Webapp service only (needs `.env` only — no storage credentials required) |
| `integrations/ob1/docker-compose.yml` | PostgreSQL + MinIO + job-search-mcp (MCP + REST API) |

```bash
# Webapp only (local mode)
docker compose -f webapp/docker-compose.yml up

# OB1 infrastructure only (postgres + minio + mcp servers)
bash scripts/start-ob1.sh up -d

# Full OB1 stack (webapp + all 3 OB1 services)
docker compose -f webapp/docker-compose.yml up &
bash scripts/start-ob1.sh up -d
```

`scripts/start-ob1.sh` sources both `.env` and `.env.services` before invoking `docker compose` so the `${VARNAME}` interpolations in `integrations/ob1/docker-compose.yml` resolve correctly. Run it with any `docker compose` subcommand (`up`, `down`, `logs`, `ps`, etc.).

For OB1 compose mode, set these in `.env.services` before running (values differ from K8s defaults):
```
DB_HOST=postgres
MINIO_ENDPOINT=minio:9000
```
And in `.env`:
```
DATA_BACKEND=ob1
JOB_SEARCH_MCP_URL=http://localhost:8081
JOB_SEARCH_REST_URL=http://job-search-mcp:8001
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

### Stop — setup status

Runs `scripts/generate-setup-status.sh` after every Claude response. Auto-generates `$APPLICANT_DIR/memory/applicant-setup-status.md` from the current state of `$APPLICANT_DIR` so the setup status shown in the webapp sidebar stays current without a manual step.

### Stop — Langfuse telemetry

Runs `scripts/langfuse_cc_hook.py` after every Claude response. Posts per-turn telemetry to Langfuse: tool use blocks, input/output token counts, and auto-detected phase tags (operations vs. development). Requires `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` in the environment or `.env.services`; silent no-op when absent. Always exits 0 so it never blocks a response.

See [docs/observability/langfuse-integration.md](docs/observability/langfuse-integration.md) for the trace schema, dashboard setup, and the Langfuse proxy for OB1 MCP call tracing.

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

Process rules live in four locations with different scopes:

| Location | Scope | When to use |
|---|---|---|
| `skills/`, `policies/`, `workflows/` | Versioned procedures; resolved per mode (interactive: draft-first; webapp: pinned-only) | **Preferred for procedural rules** — JD screening, resume generation, interview prep, storage routing, domain connection. Change via the draft → promote flow (tell Claude "draft skill <name>" / "promote skill <name>") |
| `CLAUDE.md` | Always-loaded; applies every session | Critical rules and workflow triggers that must be visible at session start |
| `memory/feedback_*.md` | Loaded on demand; indexed via `MEMORY.md` | Session/tooling mechanics (DEV_MODE, commits, model selection, doc maintenance). Migrated procedural entries are pointer stubs — do not add rules to them |
| `$APPLICANT_DIR/memory/` | Applicant-specific; local only | Role preferences, deal-breakers, search state |

**To add or update a procedural rule:** tell Claude "draft skill <name>", edit `draft.md`, exercise it on real work, then tell Claude "promote skill <name> [--pin]" (test-gated; `--pin` moves the version the webapp executes). Requires `DEV_MODE=true`.

**To add or update a session/tooling rule:**
1. Edit the relevant `memory/feedback_*.md` file (or `CLAUDE.md` for session-critical rules). Requires `DEV_MODE=true`.
2. If you edited `CLAUDE.md` or a `memory/` file, run the sync script so the live session picks up the change:
   ```bash
   bash "$APP_DIR/scripts/sync-memory.sh"
   ```
   The Stop hook runs this automatically after every Claude response — manual sync is only needed when editing outside a session.

**`MEMORY.md`** is the index for all `memory/` files. Add a one-line pointer entry whenever you create a new `feedback_*.md` file.

---

## JD Fetching

`scripts/fetch-jd.py` is a general-purpose Playwright page fetcher for login-walled URLs. It is called automatically by Claude in three contexts:

1. `/linkedin-ingest` — fetch individual LinkedIn job description pages
2. `/ingest` (Google Jobs) — fallback when WebFetch fails on a JD URL
3. Chat with URL — fallback in the create-application workflow when WebFetch hits a login wall

**Most ATS pages (Greenhouse, Lever, Workday) are public** — no auth setup needed for those. LinkedIn is the primary case requiring setup.

**Auth storage:** `$AUTH_DIR/<domain>.json` — defaults to `$APP_DIR/.auth/` when `AUTH_DIR` is not set. `$APP_DIR/.auth/` is already in `.gitignore`. See `.env.example` for `AUTH_DIR` configuration and migration instructions if you previously had auth files at `$APPLICANT_DIR/.auth/`.

**Exit codes:**
- `0` — success
- `1` — navigation error → ask user to paste JD text
- `2` — auth required or expired → run auth setup (below)
- `3` — job posting closed or no longer available → skip; folder not created

**Headless vs. Chrome mode:** Default is headless Chromium with saved session files. Works reliably for public pages and likely for non-LinkedIn login-walled pages with valid cookies. For LinkedIn, headless mode may be blocked by bot detection — Chrome profile mode is more reliable.

### Auth setup — Firefox (no window needed)

If you're logged into LinkedIn in Firefox, this imports your session silently:

```bash
source "$APP_DIR/.env"
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --setup 'https://www.linkedin.com/login'
```

Scans Firefox profiles automatically. You'll see `Saved N cookies for linkedin.com.` Re-run when exit code 2 is returned. If no Firefox session is found (or Firefox isn't installed), use Chrome.

### Auth setup — Chrome

Set `CHROME_PROFILE` in `.env` to the Chrome profile path where you're logged into LinkedIn. Find it in Chrome at `chrome://version/` → Profile Path. Log into LinkedIn in that profile first.

The script runs in one of two modes:

**Profile-launch mode (default):** Chrome opens briefly per fetch and closes. No additional setup.

**CDP mode (optional, faster):** Run `bash "$APP_DIR/scripts/launch-chrome-debug.sh"` once to start a persistent debug Chrome window. Chrome must NOT already be running on the same profile — quit it first.

### Direct fetch commands

```bash
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" "<url>"
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out "$FOLDER/jd-company-role.md" "<url>"
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --import linkedin.com
```

### Container deployment

`fetch-jd.py` works headless in containers for public ATS pages (no auth needed). For LinkedIn URLs in containers, inject the auth file via K8s secret or docker-compose volume mount and set `AUTH_DIR` to the mount path — see `.env.example` for exact commands.

**`/linkedin-ingest` (feed scraping) requires real Chrome and must run locally.** LinkedIn returns only 1–2 cards per page in headless mode vs. 25 with a real browser. Do not attempt to run `/linkedin-ingest` in a K8s pod or container.

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
| `JOB_SEARCH_MCP_URL` | Manual | Base URL for job-search MCP server (e.g. `http://localhost/job-search`) |
| `JOB_SEARCH_MCP_KEY` | Manual | Auth key for job-search MCP and REST API (`x-brain-key` header) |
| `JOB_SEARCH_REST_URL` | Manual | Base URL for job-search REST API — consumed by the webapp; K8s: `http://job-search-mcp.openbrain.svc.cluster.local:8001`; Compose: `http://job-search-mcp:8001`; local dev: `http://localhost:8001` |
| `MINIO_ENDPOINT` | Manual | MinIO S3 API address — cluster-internal: `minio.openbrain.svc.cluster.local:9000`; admin/migration use: run `kubectl port-forward svc/minio -n openbrain 9000:9000` and set to `localhost:9000` |
| `MINIO_ACCESS_KEY` | Manual | MinIO access key |
| `MINIO_SECRET_KEY` | Manual | MinIO secret key |
| `MINIO_BUCKET` | Manual | MinIO bucket name (e.g. `job-search`) |
| `DB_PASSWORD` | Manual | PostgreSQL password for OB1 shared database |

**`.env.services`** (Langfuse — optional):

| Variable | Purpose |
|---|---|
| `LANGFUSE_HOST` | Langfuse instance URL (default `https://cloud.langfuse.com`) |
| `LANGFUSE_PUBLIC_KEY` | Langfuse project public key (`pk-lf-...`) |
| `LANGFUSE_SECRET_KEY` | Langfuse project secret key (`sk-lf-...`) |

Tracing activates automatically when both keys are present. See [docs/observability/langfuse-integration.md](docs/observability/langfuse-integration.md) for the full trace schema and dashboard usage. (The OB1 Langfuse proxy container has been removed — job-search-mcp traces directly.)

**`.claude/settings.json`**:

| Field | Purpose |
|---|---|
| `hooks.PreToolUse` | Runs `check-dev-mode.sh` before Write/Edit tool calls |
| `hooks.Stop` | Three Stop hooks run after every Claude response: `sync-memory.sh` (memory commit + session sync), `generate-setup-status.sh` (setup status file), and `langfuse_cc_hook.py` (Langfuse telemetry — no-op when keys absent) |
| `permissions` | Tool allowlist — Bash commands and MCP tools that run without prompting |
| `statusLine` | Dynamic status bar generated by `scripts/status-line.sh` — shows live active count, pending-review count, and nearest follow-up date |
