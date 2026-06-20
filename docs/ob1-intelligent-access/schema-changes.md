# OB1 Intelligent Access — Schema Changes

All DDL is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Apply in phase order.

## Apply command

```bash
kubectl exec -n openbrain openbrain-0 -c postgres -- \
  psql -U postgres -d openbrain < integrations/ob1/job-search-schema.sql
```

The schema file is cumulative — re-running it is safe.

---

## Phase 1 — `js_ingested_positions`

Added to `job-search-schema.sql` at 2026-06-14.

Replaces `seen-jobs.json` + `linkedin-seen-jobs.json` as the authoritative record of every job position seen during ingestion or direct submission.

```sql
CREATE TABLE IF NOT EXISTS js_ingested_positions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url      text,
  company_name    text,
  role_title      text,
  profile_slug    text        REFERENCES js_profiles(slug) ON DELETE SET NULL,
  search_run_id   uuid        REFERENCES js_search_runs(id) ON DELETE SET NULL,
  application_id  uuid        REFERENCES js_applications(id) ON DELETE SET NULL,
  outcome         text        NOT NULL CHECK (outcome IN ('fit','no-fit','duplicate','fetch-failed')),
  no_fit_reason   text,
  is_repost       bool        NOT NULL DEFAULT false,
  first_seen_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- URL uniqueness: one canonical row per URL (duplicates log outcome='duplicate')
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingested_url_unique
  ON js_ingested_positions(source_url)
  WHERE source_url IS NOT NULL AND outcome != 'duplicate';

CREATE INDEX IF NOT EXISTS idx_ingested_company_role
  ON js_ingested_positions(lower(company_name), lower(role_title));

CREATE INDEX IF NOT EXISTS idx_ingested_profile
  ON js_ingested_positions(profile_slug) WHERE profile_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingested_created
  ON js_ingested_positions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingested_search_run
  ON js_ingested_positions(search_run_id) WHERE search_run_id IS NOT NULL;
```

**Key design notes:**
- `source_url` is nullable — chat-submitted JDs without a URL still get logged
- `is_repost` + `first_seen_at` support the 60-day repost detection window
- `application_id` FK links fit positions to their pipeline record
- `outcome='duplicate'` rows do NOT conflict with the URL unique index (partial index excludes them)

**New MCP tools (Phase 1):**
- `check_position_seen` — 4-tier dedup check
- `log_ingested_position` — insert row
- `get_ingestion_history` — list recent rows

---

## Phase 2 — `js_chunks`

Status: **drafted** — schema in job-search-schema.sql; TypeScript in job-search-tools.ts + job-search-server.ts; skills in interview-prep/draft.md + resume-generation/draft.md

Stores H2-section-level chunks for all uploaded text files. Enables `search_chunks_semantic` to return section-precise results instead of document-level embeddings.

```sql
CREATE TABLE IF NOT EXISTS js_chunks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key     text        NOT NULL,
  file_id         uuid        REFERENCES js_files(id) ON DELETE CASCADE,
  section_title   text,         -- H2 header text; null for pre-header preamble
  section_index   int         NOT NULL,  -- 0-based position in document
  content         text        NOT NULL,
  char_count      int,
  thought_id      bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_storage_key ON js_chunks(storage_key);
CREATE INDEX IF NOT EXISTS idx_chunks_file_id     ON js_chunks(file_id);
```

**New MCP tool (Phase 2):**
- `search_chunks_semantic(query, storage_key_prefix?, limit?)` — returns scored `[{storage_key, section_title, section_index, content, similarity}]`

**Backfill:** After deployment, run `integrations/ob1/scripts/backfill_chunks.ts` to chunk all existing text files.

---

## Phase 3 — Extend `js_applications` + `js_files` (Knowledge Map)

Status: **implemented** on `feat/ob1-knowledge-map`

### `js_applications` additions

Adds structured columns extracted from notes.md at process-jd time. Enables `find_similar_applications` without loading files.

```sql
ALTER TABLE js_applications ADD COLUMN IF NOT EXISTS domain_connection text;
ALTER TABLE js_applications ADD COLUMN IF NOT EXISTS domain_tags       text[];
ALTER TABLE js_applications ADD COLUMN IF NOT EXISTS jd_requirements   jsonb;
  -- format: {"required": ["...", ...], "preferred": ["...", ...]}
```

### `js_files` addition — `thought_category`

Stores the thought category (inferred or explicit) on every file record for direct queryability without joining through `thoughts`.

```sql
ALTER TABLE js_files ADD COLUMN IF NOT EXISTS thought_category text;
CREATE INDEX IF NOT EXISTS js_files_category_idx ON js_files(thought_category) WHERE thought_category IS NOT NULL;
```

### OB1 `edges` table — Phase 3 indexes

New composite indexes on OB1's shared `edges` table to support `get_entity_neighbors` and `traverse_knowledge_graph`:

```sql
CREATE INDEX IF NOT EXISTS idx_edges_relation_from ON edges(relation, from_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_relation_to   ON edges(relation, to_entity_id);
```

**New MCP tools (Phase 3):**
- `find_similar_applications(query, exclude_id?, limit?)` — semantic search across applications by domain connection
- `create_knowledge_edge(...)` — upsert typed edge in OB1 `entities`/`edges` tables
- `get_entity_neighbors(entity, ...)` — query direct neighbors; supports direction + relation filter
- `traverse_knowledge_graph(entity, ...)` — BFS traversal up to max_depth hops

---

---

## Phase 4 — OB1 Thought Metadata Schema (Knowledge Map)

No new Postgres tables or columns required. Phase 4 uses the existing `thoughts` table via `mcp__job-search__capture_thought` — the job-search MCP tool that accepts structured metadata fields (`application_id`, `thought_category`, `company`, `profile_slug`) directly, rather than embedding them as YAML in content. Do not use `mcp__open-brain__capture_thought` for job-search thought capture.

**Thought metadata schema for job-search:**

```json
{
  "source_type": "job_search",
  "thought_category": "<category>",
  "application_id": "<uuid from js_applications>",
  "application_folder": "<YYYY-MM-DD-company-role>",
  "company": "<company name>",
  "profile_slug": "<slug>"
}
```

**thought_category values:** `jd_analysis`, `fit_assessment`, `domain_connection`, `company_research`, `resume_strategy`, `interview_prep`, `meeting_notes`, `email`, `exercise`, `application_event`, `achievement`

For `interview_prep` thoughts: add `"stage_name": "<stage>"` to metadata.  
For `achievement` thoughts: omit `application_id` and `application_folder`.

**notes-index.md** (new primary application folder file):

```markdown
# [Company] — [Role Title]

**Status:** Resume Ready
**Status Detail:** Resume generated YYYY-MM-DD — not yet submitted
**Date:** YYYY-MM-DD
**Profile:** <profile-slug> (score: N/10)
**Source:** <source_name>
**Source URL:** <url>

## OB1 Thought Keys

- jd_analysis: <thought_id>
- fit_assessment: <thought_id>
- domain_connection: <thought_id>
- company_research: <thought_id>
- resume_strategy: <thought_id>
- interview_prep_1 (<stage> YYYY-MM-DD): <thought_id>
```

**Phase 4 gap — explicit edges (Phase 5 schema work):**

When OB-Graph tools are exposed via the MCP server, add these typed edges:

```
graph_edges (existing OB-Graph table):
  company_entity → "requires" → skill_entity    (from JD requirements)
  achievement_entity → "demonstrates" → skill_entity  (from profile maintenance)
```

No DDL changes required — `graph_edges` table already exists in OB-Graph recipe.

---

## Deprecated (no schema drop — backward compat)

- `js_search_runs.summary_key` — column remains for historical rows; no new rows populate it after Phase 1 workflows are promoted
- `js_search_runs.summary_thought_id` — same
