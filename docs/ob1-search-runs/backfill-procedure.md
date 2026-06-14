# OB1 Search Runs — Backfill Procedure

Populates `js_search_runs` and `js_ingested_positions` from existing OB1 summary `.md` files.

## When to run

After deploying the OB1 server version that adds:
- `GET /api/v2/search-runs`
- `POST /api/v2/search-runs`
- `POST /api/v2/ingested-positions`

Run once. The script is idempotent — re-running it skips files whose run already exists (within 60 seconds of the parsed timestamp).

## Prerequisites

1. OB1 server deployed and reachable
2. `OB1_BASE_URL` and `OB1_API_KEY` set in environment
3. Deno installed

## Command

```bash
OB1_BASE_URL=http://localhost:8001 \
OB1_API_KEY=<your-key> \
deno run --allow-net --allow-env \
  integrations/ob1/scripts/backfill_search_runs.ts
```

For the Ingress route (no port-forward needed):
```bash
OB1_BASE_URL=https://openbrain.example.com \
OB1_API_KEY=<your-key> \
deno run --allow-net --allow-env \
  integrations/ob1/scripts/backfill_search_runs.ts
```

## Expected summary `.md` format

The script parses the v1/v2 summary `.md` format. Files must match the key pattern:

```
search/YYYY-MM-DD-HHMMSS-<profile>-summary.md
```

Example: `search/2026-05-01-120000-presales-se-summary.md`

### Required header fields (bold-label format)

```markdown
**Profile:** presales-se
**Date:** 2026-05-01 12:00:00
**Pages fetched:** 3
**Total results:** 60
**New (deduped):** 45
**Screened:** 44
**Fit:** 7
```

### Required sections

```markdown
## Sub-queries

1. Solutions Engineer site:linkedin.com
2. Pre-Sales Engineer site:linkedin.com
```

```markdown
## Fit Jobs (score >= 7)

| Company | Role | Location | Score | Folder |
|---------|------|----------|-------|--------|
| Acme Corp | Solutions Engineer | Remote | 8 | 2026-05-01-acme-corp-se |
```

```markdown
## No-Fit Jobs

| Company | Role | Location | Score | Reason |
|---------|------|----------|-------|--------|
| Foo Inc | SE | NYC | 4 | On-site only |
```

```markdown
## Failed to Fetch

| Company | Role | Location | Reason |
|---------|------|----------|--------|
| Bar Co | AE | SF | auth_required |
```

Empty-state sentinel values (`_No fit jobs found._`, `_No fetch failures._`) are handled — those rows are skipped.

## Idempotency

Before inserting a run, the script calls `GET /api/v2/search-runs?profile_slug=<p>&since=<T-90s>&limit=10`. If any returned row has a `run_at` within 60 seconds of the parsed timestamp, the file is skipped.

Positions use 409 Conflict responses for dedup — the server returns 409 when a position with the same `(source_url, company_name, role_title)` already exists; the script silently skips it.

## Output

```
Connecting to OB1 at http://localhost:8001 …
Found 12 summary file(s) to process.

  [OK]   search/2026-05-01-120000-presales-se-summary.md — run a1b2c3d4 — 44 positions
  [SKIP] search/2026-05-10-090000-presales-se-summary.md — run already exists
  [OK]   search/2026-05-20-150000-presales-se-summary.md — run e5f6a7b8 — 38 positions
  ...

Done: 10 runs created, 2 skipped, 420 positions inserted, 0 errors
```

Exit code 1 if any file produced an error.
