# OB1 Intelligent Access — Chunking Design (Phase 2)

Status: **drafted** — see Phase 2 entry in schema-changes.md for deploy steps.

## Goal

Replace full-file context loads in interview-prep and resume-generation with section-precise retrieval. Target: context size < 40% of original full-file load, with no loss of required sections.

## Algorithm

### `chunkMarkdown(text: string)`

Splits a markdown document into H2-level sections.

```
Input: full text of a .md file
Output: Array<{ title: string | null, index: number, content: string }>
```

Rules:
1. Split on `\n## ` boundary (any H2 header)
2. Preamble (text before first `## `) → chunk 0, `title = null`
3. Each `## Foo` block → one chunk, `title = "Foo"`, `index = n`
4. Skip empty chunks (< 30 chars after trim)
5. Max chunk size: 8000 chars. If a section exceeds this, split at paragraph boundaries (`\n\n`) and create sub-chunks with `title = "Foo (continued <n>)"` and sequential section_index values
6. Minimum prefix guard: if `coPrefix.length < 4` or `rolePrefix.length < 4`, skip tier-4 fuzzy check in `check_position_seen` (too short to be meaningful)

### Upload pipeline integration (`uploadFileCore`)

After the existing whole-document thought capture, call chunking for all `text/*` files:

1. `chunks = chunkMarkdown(content)`
2. Delete existing rows in `js_chunks` for this `storage_key` (idempotent re-upload)
3. For each chunk:
   - `captureThought(chunk.content, { type: "file-chunk", storage_key, section_title: chunk.title, section_index: chunk.index })`
   - Insert into `js_chunks` with the returned `thought_id`

The whole-document thought (existing behavior) is preserved — it serves `search_applications_semantic`. Chunks serve `search_chunks_semantic`. Both coexist.

## `search_chunks_semantic` Query

```sql
SELECT
  c.storage_key,
  c.section_title,
  c.section_index,
  c.content,
  t.embedding <=> $query_embedding AS similarity
FROM js_chunks c
JOIN thoughts t ON c.thought_id = t.id
WHERE ($prefix IS NULL OR c.storage_key LIKE $prefix || '%')
ORDER BY similarity ASC   -- pgvector cosine distance: lower = more similar
LIMIT $limit
```

Returns results with `similarity < 0.4` threshold (cosine distance; ≈ > 60% semantic similarity). Results with `similarity >= 0.4` are filtered out as insufficiently relevant.

## Retrieval Patterns by Skill

### interview-prep

Required sections (must appear in results or trigger fall-back):
- Any section with `title LIKE '%Interview Prep%'`
- `## Domain Connection`
- `## Process`

Query:
```
search_chunks_semantic(
  query = "interview prep talking points cautions stage process domain connection",
  storage_key_prefix = "applications/<folder>/",
  limit = 6
)
```

Fall-back for missing required sections: call `get_file('applications/<folder>/notes.md')` and extract the specific section by heading. Log a warning: "Semantic retrieval missed section '<title>' — loaded from full file."

### resume-generation

Always-load sections (structural anchors, regardless of JD content):
- Any section with `title LIKE '%Role Classification%'` from `EXPERIENCE-REFERENCE.md`
- `## Education` from `EXPERIENCE-REFERENCE.md`
- `## Certifications` from `EXPERIENCE-REFERENCE.md`

Per-requirement retrieval (for each Required JD requirement):
```
search_chunks_semantic(
  query = "<requirement text>",
  storage_key_prefix = "profiles/<profile>/",
  limit = 3
)
```

Deduplicate results by `section_title` across all requirement queries. Load the union of top-scoring unique sections.

Fall-back: if retrieval returns < 3 unique sections, load full `profile-CONTENT.md`.

## Backfill Procedure

Run once after Phase 2 deployment:

```bash
# integrations/ob1/scripts/backfill_chunks.ts
# Reads all js_files rows with text/* content_type, fetches from MinIO, chunks and embeds

deno run --allow-net --allow-env \
  integrations/ob1/scripts/backfill_chunks.ts
```

Expected runtime: ~2 minutes per 100 files (limited by embedding API rate). Run during off-peak hours.

## Relationship to Phase 4 (Knowledge Map)

Phase 2 chunks and Phase 4 thoughts are **complementary, not competing**:

| Mechanism | Granularity | Best for |
|---|---|---|
| Phase 2 chunks (`js_chunks`) | H2 section of a file | Per-requirement fuzzy retrieval from CONTENT.md during resume generation |
| Phase 4 thoughts (OB1 `thoughts`) | Full application knowledge section | Retrieving application-specific content (fit assessment, interview prep, domain connection) by known thought ID |

The chunk pipeline captures file content for profile retrieval. The thought pipeline captures application-event knowledge for interview prep and cross-app reasoning. They share OB1's embedding infrastructure but serve different query patterns.

**When to use `search_chunks_semantic`:** Fuzzy content match — "find resume bullets similar to this JD requirement."  
**When to use `mcp__open-brain__fetch`:** Known thought retrieval — "load the jd_analysis thought for this application (ID from notes-index.md)."

## Evaluation Results (to be filled after implementation)

| Test | Target | Actual |
|------|--------|--------|
| Chunk precision (top-2 for 5 notes.md files) | ≥ 4/5 | — |
| Context reduction (top-6 chunks vs. full file) | < 40% | — |
| Required-section coverage (5 test apps) | 3/3 sections found | — |
| Fallback rate | < 20% of sessions | — |
| Re-upload idempotency | chunk count unchanged | — |
| search_chunks_semantic latency (≤15 files) | < 2s | — |
