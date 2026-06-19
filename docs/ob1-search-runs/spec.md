# OB1 Search Runs — API Spec & Schema

## Tables

### `js_search_runs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | auto-generated |
| `profile_id` | uuid FK → `js_profiles.id` | nullable (linkedin-recommended has no profile row) |
| `query` | text | sub-queries joined with ` \| ` |
| `pages_fetched` | int | |
| `total_results` | int | |
| `new_after_dedup` | int | screened + fetch_failed; excludes duplicates |
| `screened` | int | jobs that reached jd-evaluation |
| `fit_count` | int | |
| `summary_key` | text | OB1 file store key for the per-run summary `.md` |
| `run_at` | timestamptz | defaults to `now()` |

`fetch_failed_count` is NOT stored — computed via correlated subquery from `js_ingested_positions`.

### Computed field

```sql
COALESCE(
  (SELECT COUNT(*)::int FROM js_ingested_positions ip
   WHERE ip.search_run_id = sr.id AND ip.outcome = 'fetch-failed'),
  0
) AS fetch_failed_count
```

---

## REST Endpoints (OB1 server — `/api/v2/`)

### `GET /api/v2/search-runs`

Returns run-level history. Identical to `get_search_runs` MCP tool.

**Query params:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `profile_slug` | string | — | Filter by profile; omit for all profiles |
| `since` | string (ISO date) | — | Only runs with `run_at >= since` |
| `limit` | int | 20 | Max 200 |

**Response:** `SearchRunRow[]` (JSON array)

```typescript
type SearchRunRow = {
  id: string
  profile_slug: string | null
  query: string
  pages_fetched: number
  total_results: number
  new_after_dedup: number
  screened: number
  fit_count: number
  fetch_failed_count: number  // computed
  summary_key: string | null
  run_at: string              // ISO timestamp
}
```

### `POST /api/v2/search-runs`

Creates a new run record. Used by the backfill script; normal workflow use goes through MCP.

**Body:** `LogSearchRunArgs`

```typescript
type LogSearchRunArgs = {
  profile_slug: string
  query: string
  pages_fetched: number
  total_results: number
  new_after_dedup: number
  screened: number
  fit_count: number
  summary_key?: string | null
}
```

**Response:** `{ id: string }` — 201 Created

### `POST /api/v2/ingested-positions`

Creates a position audit row. Used by the backfill script; normal workflow use goes through MCP.

**Body:** `LogIngestedPositionArgs`

```typescript
type LogIngestedPositionArgs = {
  source_url?: string | null
  company_name: string
  role_title: string
  profile_slug?: string | null
  search_run_id?: string | null
  application_id?: string | null
  outcome: 'fit' | 'no-fit' | 'duplicate' | 'fetch-failed'
  no_fit_reason?: string | null
  is_repost?: boolean
  first_seen_at?: string | null
}
```

**Response:** `{ ok: true }` — 201 Created. 409 Conflict if position already exists (idempotent on duplicate).

---

## MCP Tools

### `log_search_run`

Same args as `POST /api/v2/search-runs`. **Returns** `{ id, profile_slug, fit_count, total_results }` — capture `id` as `search_run_id` for subsequent `log_ingested_position` calls.

### `get_search_runs`

Args: `{ profile_slug?, since?, limit }`. Returns `SearchRunRow[]`.

---

## Webapp API (`/api/search-runs`)

The FastAPI Python backend proxies to OB1 and wraps the response.

**`GET /api/search-runs`**

Query params: `profile_slug`, `since`, `limit` (same as OB1 endpoint).

Response: `{ records: SearchRunRow[] }`. Returns `{ records: [] }` when `DATA_BACKEND != ob1`.
