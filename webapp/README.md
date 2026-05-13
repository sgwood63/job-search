# Job Search Browser

A local web app for browsing and managing job search data — applications, profiles, base documents, and search results. Built with FastAPI (backend) and React/TypeScript/Vite (frontend).

## Prerequisites

- Python 3.8+
- Node.js + npm
- Project `.env` file at the repo root with `APPLICANT_DIR` and `APP_DIR` set (created by `bash scripts/setup.sh`)

## Configuration

The backend reads these variables from the `.env` file at the project root:

| Variable | Required | Description |
|----------|----------|-------------|
| `APPLICANT_DIR` | Yes | Path to applicant data directory — all file operations are scoped here |
| `APP_DIR` | Yes | Path to this repo |
| `DEV_MODE` | No | `true` = file edits allowed; `false` (default) = read-only |

In development, Vite proxies all `/api/*` requests to `http://localhost:8000` — no additional network configuration needed.

## Install Dependencies

```bash
# Backend
pip install -r webapp/backend/requirements.txt

# Frontend
cd webapp/frontend
npm install
```

## Launch — Development

Run both servers simultaneously (two terminals from the repo root):

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

## Launch — Production

Build the frontend once, then run only the backend (it serves the built assets):

```bash
cd webapp/frontend
npm run build

cd ../backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open [http://localhost:8000](http://localhost:8000).

## Features

| View | Description |
|------|-------------|
| Tracker | Parses `application-tracker.md` into active / phase-D / closed tables |
| Applications | Browse per-application folders and files |
| Profiles | View profile content libraries |
| Base Docs | Browse base documents |
| Search | Browse ingestion run summaries |

Files render as formatted markdown. Markdown files can be edited inline. File uploads are restricted to `base-documents/` and `applications/` directories.
