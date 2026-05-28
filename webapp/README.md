# Job Search Browser

A local web app for browsing and managing job search data — applications, profiles, base documents, and search results. Built with FastAPI (backend) and React/TypeScript/Vite (frontend).

The backend supports two data modes, selected by `DATA_BACKEND` in `.env`:

| Mode | `DATA_BACKEND` | Data source |
|------|----------------|-------------|
| **Local** (default) | `local` | Files read directly from `APPLICANT_DIR` on the local filesystem |
| **OB1** | `ob1` | PostgreSQL (`js_*` tables) for pipeline state + MinIO or Supabase for file content |

## Prerequisites

- Python 3.8+ and Node.js + npm
- Project `.env` file at the repo root (created by `bash scripts/setup.sh`)
- **Claude Code 2.1.152+** — required for the chat sessions the webapp spawns. `bash webapp/start.sh` checks the version and fails fast if the binary is below this. Set `CLAUDE_BINARY` in `.env` to pin to a specific path (e.g. the VS Code extension binary); defaults to the system `claude` in PATH.
- **Local mode:** `APPLICANT_DIR` must be set and the directory must exist
- **OB1 mode:** OB1 services must be running and reachable (see OB1 section below)

## Configuration

The backend loads all configuration from the `.env` file at the project root.

### Common

| Variable | Description |
|----------|-------------|
| `DATA_BACKEND` | `local` (default) or `ob1` |
| `APP_DIR` | Path to this repo |
| `APPLICANT_DIR` | Path to applicant data directory (required for local mode) |
| `DEV_MODE` | `true` = APP_DIR file edits allowed; `false` (default) = read-only |
| `CLAUDE_BINARY` | Path to the Claude Code binary for chat sessions (default: `claude` in PATH). Must be 2.1.152+. |

### OB1 mode — PostgreSQL

| Variable | Description |
|----------|-------------|
| `DB_HOST` | PostgreSQL host (default `localhost`) |
| `DB_PORT` | PostgreSQL port (default `5432`) |
| `DB_NAME` | Database name (default `openbrain`) |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |

### OB1 mode — object store

| Variable | Description |
|----------|-------------|
| `OBJECT_STORE_BACKEND` | `minio` (default) or `supabase` |
| `MINIO_ENDPOINT` | MinIO S3 endpoint (e.g. `localhost:30900`) |
| `MINIO_ACCESS_KEY` | MinIO access key |
| `MINIO_SECRET_KEY` | MinIO secret key |
| `MINIO_BUCKET` | Bucket name (default `job-search`) |
| `MINIO_SECURE` | `true` for TLS (default `false`) |
| `SUPABASE_URL` | Supabase project URL (Supabase backend only) |
| `SUPABASE_SERVICE_KEY` | Service role key (Supabase backend only) |
| `SUPABASE_BUCKET` | Bucket name (Supabase backend only, default `job-search`) |

### OB1 mode — prerequisites

OB1 services must be running and reachable:
- PostgreSQL at `DB_HOST:DB_PORT`
- MinIO at `MINIO_ENDPOINT` or Supabase Storage

Port-forwards if using local K8s:
```bash
kubectl port-forward -n openbrain svc/openbrain 5432:5432 &
kubectl port-forward -n openbrain svc/minio 30900:9000 &
```

In development, Vite proxies all `/api/*` requests to `http://localhost:8000` — no additional network configuration needed.

## Install Dependencies

```bash
# Backend
pip install -r webapp/backend/requirements.txt

# Frontend
cd webapp/frontend
npm install
```

## Launch — Recommended (single script)

```bash
bash webapp/start.sh
```

Opens at [http://localhost:8000](http://localhost:8000). Runs the backend and `vite build --watch` together — the dist rebuilds automatically whenever you edit frontend files.

## Launch — Development (Vite dev server)

Use this for instant HMR (hot-module reload):

**Terminal 1 — Backend (port 8000):**
```bash
cd webapp/backend
uvicorn main:app --reload
```

**Terminal 2 — Frontend (port 5173):**
```bash
cd webapp/frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Launch — One-time build only

```bash
cd webapp/frontend && npm run build
cd ../backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

Open [http://localhost:8000](http://localhost:8000).

## Features

| View | Local mode | OB1 mode |
|------|------------|----------|
| Tracker | Parses `application-tracker.md` | Queries `js_applications` (PostgreSQL) |
| Applications | Scans `applications/` directory | Queries `js_files` + `js_applications` |
| Profiles | Scans `profiles/` directory | Queries `js_profiles` + `js_files` |
| Base Docs | Scans `base-documents/` directory | Queries `js_files` |
| Search | Scans `search/` directory | Queries `js_files` |
| Help / Docs | Reads from `APP_DIR` directly | Reads from object store `docs/` prefix |
| Contacts | Not available (returns empty) | Queries `js_contacts` (PostgreSQL) |

Files render as formatted markdown. Markdown files can be edited inline. File uploads are restricted to `base-documents/` and `applications/` prefixes.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | OB1 connectivity check — returns `{db, store}` status |
| `GET` | `/api/tracker` | Pipeline data including next scheduled interview |
| `GET` | `/api/applications` | List application folders |
| `GET` | `/api/applications/{folder}` | Files in an application folder |
| `GET` | `/api/profiles` | Profile list + reference files |
| `GET` | `/api/base-documents` | Base document tree |
| `GET` | `/api/search` | Ingestion run summary tree |
| `GET` | `/api/contacts?company=` | Contacts from `js_contacts`, optional company filter |
| `GET` | `/api/file?path=` | Fetch file content from object store |
| `GET` | `/api/file/url?path=` | Presigned URL for direct object store download |
| `PUT` | `/api/file?path=` | Edit a markdown file (`.md` only) |
| `DELETE` | `/api/file?path=` | Delete a file (restricted to `applications/` and `base-documents/`) |
| `POST` | `/api/upload?dir=` | Upload a file (restricted to `applications/` and `base-documents/`) |
| `GET` | `/api/docs` | List allowlisted documentation files |
| `GET` | `/api/docs/file?name=` | Fetch a documentation file |
| `GET` | `/api/setup-status` | Parse applicant setup phase completion |
| `POST` | `/api/sessions` | Create a Claude Code chat session |
| `GET` | `/api/sessions` | List active sessions |
| `WS` | `/ws/session/{id}` | Stream Claude Code output |

## Verifying Connectivity

```bash
curl http://localhost:8000/api/health
```

Local mode response:
```json
{"backend": "local", "store": "ok"}
```

OB1 mode response:
```json
{"backend": "ob1", "db": "ok", "store": "ok"}
```

If `store` or `db` returns `"error"` in OB1 mode, check that the PostgreSQL and MinIO port-forwards are active and the `.env` credentials are correct.

## Testing

### Backend (pytest)

The backend test suite requires the `.venv` virtual environment.

**Install test dependencies (first time only):**
```bash
cd webapp/backend
source .venv/bin/activate
pip install -r tests/requirements-test.txt   # pytest, pytest-asyncio, httpx
```

**Run all tests:**
```bash
cd webapp/backend
source .venv/bin/activate
pytest
```

**Run a specific file or test:**
```bash
pytest tests/test_api.py
pytest tests/test_api.py::test_health_ok
pytest -v   # verbose output
```

What's covered:

| File | Tests | Covers |
|------|-------|--------|
| `test_api.py` | 30+ | Path validation helpers, all REST endpoints (health, tracker, file CRUD, applications, setup-status, docs allowlist) |
| `test_storage.py` | 12 | LocalStore async CRUD, list, delete, presigned URLs, factory singleton |
| `test_tracker.py` | 20+ | `slugify()`, `parse_table()`, `match_folder()`, `parse_tracker()` (full markdown pipeline) |

Tests use a temporary directory for `APPLICANT_DIR` — no real applicant data is touched. `DATA_BACKEND=local` is set automatically by test fixtures; no OB1 services are needed.

### Frontend (Vitest)

No extra setup needed — Vitest and the testing libraries are in `devDependencies` and installed by `npm install`.

**Run all tests once:**
```bash
cd webapp/frontend
npm test
```

**Run in watch mode (re-runs on file save):**
```bash
npm run test:watch
```

What's covered:

| File | Tests | Covers |
|------|-------|--------|
| `api.test.ts` | 5 suites | Fetch wrapper functions (tracker, getFile, putFile, fileUrl, setupStatus) — correct URLs, headers, and error handling |
| `TrackerView.test.tsx` | 6 | Component rendering, loading state, section headers, count badges, error display |

No browser or backend required — jsdom provides a DOM environment and MSW (Mock Service Worker) intercepts fetch calls. No `.env` needed.
