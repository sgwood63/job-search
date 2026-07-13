# OB1 Search Runs — Deployment Checklist

## Context

All code changes are complete on branch `hermes` (18 files changed, 2121 insertions). The implementation adds:
- `getSearchRunsCore` + `GET /api/v2/search-runs`, `POST /api/v2/search-runs`, `POST /api/v2/ingested-positions` to the OB1 MCP server
- `logSearchRunCore` fixed to return UUID (RETURNING id)
- `GET /api/search-runs` endpoint in FastAPI + `searchRuns()` in frontend `api.ts`
- "Run History" tab in `SearchView.tsx`
- Tests across backend and frontend
- `integrations/ob1/scripts/backfill_search_runs.ts` (REST-only, standalone Deno script)
- Promoted workflows: `search-jobs` v2, `search-jobs-linkedin` v2, `create-application` v3
- Updated policies, CLAUDE.md, MEMORY.md, docs/ob1-search-runs/

**Database state confirmed:** All tables already exist (`js_search_runs` has 12 rows, `js_ingested_positions` has 0 rows, `js_applications` has the new columns). No schema migration needed.

**Running K8s cluster:** Both `job-search-mcp` and `job-search-webapp` deployments are live but serving the OLD image (neither has the new search-runs endpoints).

---

## Steps (in order)

### 0. Pre-deployment
- [ ] Set `READONLY_DEPLOYMENT=true` in `.env`
- [ ] Optionally run tests locally first (see Verification section)

### 1. Commit

Stage and commit all changes on branch `hermes`:

**Untracked files to include:**
- `integrations/ob1/scripts/backfill_search_runs.ts`
- `docs/ob1-search-runs/spec.md`
- `docs/ob1-search-runs/backfill-procedure.md`
- `docs/ob1-search-runs/deploy-checklist.md`
- `workflows/search-jobs/v2.md`
- `workflows/search-jobs-linkedin/v2.md`
- `workflows/create-application/v3.md`
- `policies/storage-routing/draft.md`
- `webapp/frontend/src/__tests__/ApplicationView.test.tsx`
- `webapp/frontend/src/__tests__/SearchView.test.tsx`
- Workflow drafts (optional — `workflows/*/draft.md`)

**Leave unstaged:** `skills/interview-prep/draft.md`, `skills/resume-generation/draft.md`, other draft files not updated in this session.

### 2. Build and deploy job-search-mcp

Changed files: `job-search-tools.ts`, `job-search-server.ts`. Build context is `integrations/ob1/`.

```bash
# From repo root
docker build -f integrations/ob1/Dockerfile -t job-search-mcp:latest integrations/ob1/
kubectl rollout restart deployment/job-search-mcp -n openbrain
kubectl rollout status deployment/job-search-mcp -n openbrain   # wait for Ready
```

### 3. Build and deploy webapp

All `webapp/`, `scripts/`, `CLAUDE.md`, `memory/`, `workflows/`, `policies/` changes are included via root-context Dockerfile.

```bash
# From repo root
docker build -f webapp/Dockerfile -t job-search-webapp:latest .
kubectl rollout restart deployment/job-search-webapp -n openbrain
kubectl rollout status deployment/job-search-webapp -n openbrain   # wait for Ready
```

### 4. Run the backfill (Option B — wipe and recreate)

**Prerequisite:** Step 2 (job-search-mcp) must be fully deployed first.

**Why clear first:** The 12 existing `js_search_runs` rows have `summary_key = null` and no linked positions. The backfill detects matching timestamps and skips, so positions would never be linked. Clearing lets the backfill recreate all rows with `summary_key` and full position detail.

```bash
# Step 4a — clear existing run rows (positions table is already empty)
kubectl exec -n openbrain openbrain-0 -c db -- bash -c \
  "psql -U postgres -d openbrain -c 'DELETE FROM js_search_runs;'"

# Step 4b — run backfill
source .env
OB1_BASE_URL=http://localhost/job-search \
OB1_API_KEY="$JOB_SEARCH_MCP_KEY" \
deno run --allow-net --allow-env integrations/ob1/scripts/backfill_search_runs.ts
```

If Deno is not installed locally:
```bash
source .env
docker run --rm -it --network host \
  -e OB1_BASE_URL=http://localhost/job-search \
  -e OB1_API_KEY="$JOB_SEARCH_MCP_KEY" \
  -v "$(pwd)/integrations/ob1/scripts:/scripts" \
  denoland/deno:2.3.3 \
  run --allow-net --allow-env /scripts/backfill_search_runs.ts
```

Expected output: N runs created, 0 skipped, M positions inserted, 0 errors.

---

## Verification

**After Step 2 (job-search-mcp):**
```bash
kubectl logs -n openbrain -l app=job-search-mcp --tail=30

# Test new GET endpoint (K8s Ingress)
source .env
curl -s -H "x-brain-key: $JOB_SEARCH_MCP_KEY" \
  "http://localhost/job-search/api/v2/search-runs?limit=5" | jq 'length'
# Expect: integer (number of run rows)
```

**After Step 3 (webapp):**
```bash
kubectl logs -n openbrain -l app=job-search-webapp -c webapp --tail=20

# Test FastAPI proxy
curl -s "http://localhost/search-runs?limit=5" | jq '.records | length'
# Expect: integer
```

**In the UI:**
- Open webapp → Search tab → expand "Search History" → click "Runs" tab
- Should show table: Date | Profile | Query | Pages | Total | Screened | Fit | Failed
- Rows appear (12 from backfill)

**Run test suites:**
```bash
# Backend
cd webapp && python -m pytest backend/tests/ -v -x

# Frontend
cd webapp/frontend && npm test
```

**After next `/ingest` or `/linkedin-ingest` run:**
- New run appears in "Runs" tab with stats
- `get_ingestion_history(limit=50)` shows rows with `search_run_id` populated
- Summary `.md` appears in SearchView file tree
