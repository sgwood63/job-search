# Scripts

## setup.sh

One-time setup script. Run from the repo root before starting a job search.

```bash
bash scripts/setup.sh
```

Detects an existing applicant configuration and offers a **refresh** path (re-check deps, auth, sync) or a **new applicant** path. On new setup:

1. Checks Claude Code auth (OAuth or API key)
2. Installs PDF generation dependencies: pandoc, poppler
3. Detects Playwright Python installation and records it in `.env`
4. Detects installed cloud sync services; presents a numbered menu to set `$APPLICANT_DIR`
5. Writes `.env` with `APP_DIR`, `APPLICANT_DIR`, `APPLICANT_NAME`, `PLAYWRIGHT_PYTHON`, and auth config
6. Scaffolds `$APPLICANT_DIR` with stub files from `templates/scaffold/`

Safe to re-run — existing files are never overwritten (triggers refresh path instead).

---

## fetch-jd.py

Playwright-based job description fetcher. Called automatically by Claude during the JD workflow.

```bash
source "$APP_DIR/.env"

# Fetch a public URL (no auth needed)
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" "<url>"

# Fetch and save full page text as markdown to a file
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out "$FOLDER/jd-company-role.md" "<url>"

# Fetch and print full page text as markdown to stdout
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out - "<url>"

# First-time auth setup for a login-walled site (e.g. LinkedIn)
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --setup 'https://www.linkedin.com/jobs/view/123'

# Import cookies from Firefox without opening a browser
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --import linkedin.com

# Clear saved auth for a domain
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --clear linkedin.com

# List all domains with saved auth
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --list
```

Exit codes:
- `0` — success
- `1` — navigation error (ask user to paste JD text)
- `2` — auth required or expired (re-run `--setup` or `--import`)
- `3` — job posting closed or no longer available (folder not created)

Auth cookies are saved to `$APPLICANT_DIR/.auth/<domain>.json`. Re-run `--setup` or `--import` when exit code 2 is returned.

---

## generate-pdf.py

Converts an HTML resume file to PDF using Playwright (headless Chromium). Produces clean output with no filename or filepath in headers/footers.

```bash
source "$APP_DIR/.env"
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

Always source `.env` before running — `$PLAYWRIGHT_PYTHON` must be set. Never use `--print-to-pdf` via Chrome directly; Chrome adds filename/filepath to the header/footer.

---

## search-jobs.py

Searches Google Jobs via SearchAPI for a given profile. Deduplicates results against `seen-jobs.json`. Called automatically by Claude during `/ingest`.

```bash
source "$APP_DIR/.env"

# Search with default profile query
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/search-jobs.py" <profile-name>

# Override the default search query
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/search-jobs.py" <profile-name> --query "<query>"

# Resume a paginated search
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/search-jobs.py" <profile-name> --page-token <token>

# Append results to a NDJSON file instead of printing to stdout
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/search-jobs.py" <profile-name> --batch-out <file>

# Print the query and estimated result count; do not call the API
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/search-jobs.py" <profile-name> --dry-run
```

Parameters:
- `profile-name` — required; profile slug (e.g. `presales-se`)
- `--query` — override the profile's default search query
- `--page-token` — resume pagination from a prior `next_page_token`
- `--batch-out` — append results as NDJSON to this file path
- `--batch-size N` — max new jobs to return; overrides `SEARCH_BATCH_SIZE` env var for this call
- `--dry-run` — inspect query without fetching

Exit codes: `0` (success), `1` (missing env, profile not found, API error)

Required env: `APP_DIR`, `APPLICANT_DIR`, `SEARCHAPI_KEY`
Optional env: `SEARCH_BATCH_SIZE` (default 10)

---

## check-md-hygiene.sh

Pre-commit hook that enforces two rules on every `.md` file staged in `$APP_DIR`:

1. **No personal names** — rejects commits containing the applicant's name (read from `.env`)
2. **No hard-coded absolute paths** — rejects commits containing literal home directory paths

Install once with `bash scripts/install-hooks.sh`. Runs automatically on every `git commit`.

---

## check-dev-mode.sh

PreToolUse hook that blocks Claude's Write and Edit tools from modifying files in `$APP_DIR` when `DEV_MODE=false`.

Registered in `.claude/settings.json` under `PreToolUse` for the `Write` and `Edit` tool matchers. Reads `DEV_MODE` from `.env` on every call — no session restart needed when toggling.

**To enable APP_DIR editing:**
1. In `.env`, set `DEV_MODE="true"`
2. Ask Claude to proceed (reply "continue" if it paused waiting)
3. When done, set `DEV_MODE="false"` again

---

## install-hooks.sh

Installs git hooks into `.git/hooks/`. Run once after cloning:

```bash
bash scripts/install-hooks.sh
```

Installs `pre-commit` → `scripts/check-md-hygiene.sh`.

---

## sync-memory.sh

Commits any uncommitted changes in `$APP_DIR/memory/` and copies all `memory/*.md` files to `~/.claude/projects/.../memory/` so the live session picks them up on the next message. Run automatically by the Stop hook after every Claude response.

```bash
bash "$APP_DIR/scripts/sync-memory.sh"
```

No parameters. Idempotent — no-ops if nothing has changed. Use this after editing memory files outside a session (e.g., directly in a text editor).

---

## summarize-write.sh

PostToolUse hook registered in `.claude/settings.json`. Runs automatically after every Claude `Write` tool call and outputs a one-line impact summary for significant file writes (e.g., resume written, notes updated). Suppresses output for routine or system files. Not intended to be run manually.

---

## linkedin-job-url-collector-manual.js

Browser console script for manually collecting LinkedIn job URLs. Paste into browser DevTools console on a LinkedIn jobs search page, then click jobs — the script captures their URLs automatically.

Console functions available after pasting:
- `downloadUrls()` — downloads a text file of all captured URLs
- `urlStatus()` — prints count of captured URLs to console

Not a CLI script — runs in the browser only. See [README-linkedin-extractors.md](README-linkedin-extractors.md) for full instructions.

---

## k8s-apply-env.sh

Creates k8s Secrets and ConfigMaps in the `openbrain` namespace from `.env` values. Also auto-generates `.mcp.json` for Claude Code with the correct `"type": "http"` transport and `/mcp` URL suffix. Re-run after any credential or config change; takes effect on next pod restart.

```bash
source "$APP_DIR/.env"
bash "$APP_DIR/scripts/k8s-apply-env.sh"
```

Creates/updates: `openbrain-secret`, `openbrain-configmap`, `minio-secret`, `job-search-secret`, `job-search-llm-config`, `webapp-secret`. Generates `.mcp.json` (gitignored) for Claude Code.

Required env: `OB1_MCP_KEY`, `JOB_SEARCH_MCP_KEY`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `DB_PASSWORD`, `LLM_API_KEY`, and all associated `*_URL`, `*_BASE`, `*_MODEL` vars. See `.env.example` for the full list.

---

## migrate-to-ob1.py

Migrates existing local applicant files from `$APPLICANT_DIR` to OB1: uploads all files to MinIO, inserts records into `js_files`, populates `js_applicant` and `js_profiles` from `applicant.md`, and migrates application folders to `js_applications`. Requires Python venv with `psycopg2-binary minio` and an active port-forward to PostgreSQL.

```bash
# Start port-forward (migration connects to localhost:5432)
kubectl port-forward svc/openbrain-db -n openbrain 5432:5432 &
PF_PID=$!

source .venv/bin/activate && source "$APP_DIR/.env"
python "$APP_DIR/scripts/migrate-to-ob1.py" --dry-run   # preview without writing
python "$APP_DIR/scripts/migrate-to-ob1.py"             # full run

kill $PF_PID
```

Exit codes: `0` (success), `1` (connection error, missing env, or parse failure).

Required env: `APP_DIR`, `APPLICANT_DIR`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.

---

## generate-setup-status.sh

Auto-generates `$APPLICANT_DIR/memory/applicant-setup-status.md` from the current state of `$APPLICANT_DIR`. Captures which onboarding phases are complete, active profiles, and recent maintenance. Run automatically by the Stop hook after every Claude response. Not intended to be run manually.

---

## status-line.sh

Generates the dynamic status bar displayed in the Claude Code VS Code extension. Reads the application tracker live and outputs active application count, pending-review count, and nearest follow-up date. Configured in `.claude/settings.json` under `statusLine`. Runs on every render of the status bar — not intended to be run manually.

---

## Environment Variables

| Variable | Used by | Required | Default | Purpose |
|---|---|---|---|---|
| `APP_DIR` | All scripts | Yes | Set by setup.sh | Path to this repo |
| `APPLICANT_DIR` | fetch-jd.py, search-jobs.py, check-md-hygiene.sh, summarize-write.sh, sync-memory.sh | Yes | Set by setup.sh | Path to applicant data directory |
| `APPLICANT_NAME` | check-md-hygiene.sh | Yes | Set by setup.sh | Used to detect name leaks in commits |
| `PLAYWRIGHT_PYTHON` | fetch-jd.py, generate-pdf.py, search-jobs.py | Yes | Set by setup.sh | Python interpreter with Playwright installed |
| `DEV_MODE` | check-dev-mode.sh | No | `"false"` | `"true"` enables APP_DIR writes |
| `SEARCHAPI_KEY` | search-jobs.py | Yes (for /ingest) | — | SearchAPI authentication key |
| `SEARCH_BATCH_SIZE` | search-jobs.py | No | 10 | Max new jobs per API call |
| `OB1_REPO_PATH` | k8s-apply-env.sh (image build) | Yes (OB1 k8s) | — | Path to local OB1 repo clone; image built from `$OB1_REPO_PATH/integrations/kubernetes-deployment/` |
| `OB1_MCP_URL` | k8s-apply-env.sh, .mcp.json | Yes (OB1) | K8s: `http://localhost/ob1` · Compose: `http://localhost:8080` | Base URL for OB1 MCP server |
| `OB1_MCP_KEY` | k8s-apply-env.sh, .mcp.json | Yes (OB1) | — | Auth key for OB1 MCP (`x-brain-key` header) |
| `JOB_SEARCH_MCP_URL` | k8s-apply-env.sh, .mcp.json | Yes (OB1) | K8s: `http://localhost/job-search` · Compose: `http://localhost:8081` | Base URL for job-search MCP server |
| `JOB_SEARCH_MCP_KEY` | k8s-apply-env.sh, .mcp.json | Yes (OB1 k8s) | — | Auth key for job-search MCP (`x-brain-key` header) |
| `MINIO_ENDPOINT` | migrate-to-ob1.py, k8s-apply-env.sh | Yes (OB1 k8s) | `localhost:30900` | MinIO S3 API address |
| `MINIO_ACCESS_KEY` | migrate-to-ob1.py, k8s-apply-env.sh | Yes (OB1 k8s) | — | MinIO access key |
| `MINIO_SECRET_KEY` | migrate-to-ob1.py, k8s-apply-env.sh | Yes (OB1 k8s) | — | MinIO secret key |
| `MINIO_BUCKET` | migrate-to-ob1.py, k8s-apply-env.sh | Yes (OB1 k8s) | `job-search` | MinIO bucket name |
| `DB_PASSWORD` | migrate-to-ob1.py, k8s-apply-env.sh | Yes (OB1 k8s) | — | PostgreSQL password (OB1 shared database) |
