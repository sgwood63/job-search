# File Management, Search, and Chunking Architecture — Job Search OB1 Sidecar

## 1. Architecture Overview: Three Layers

The system is a **domain-specific sidecar** on top of OB1's PostgreSQL + MinIO stack. It does not replace OB1 — it extends it. Three schema layers coexist in one Postgres database:

| Layer | Tables | Purpose |
|---|---|---|
| **OB1 Core** | `thoughts`, `match_thoughts()` | Embedding store + pgvector semantic search |
| **Knowledge Graph** | `entities`, `edges`, `thought_entities` | Typed entity–relation graph with evidence links |
| **Domain Extension** | `js_files`, `js_chunks`, `js_applications`, `js_companies`, `js_profiles`, `js_contacts`, `js_interviews`, `js_search_runs`, `js_ingested_positions` | Domain object model + file catalog + audit trail |

Every uploaded file participates in all three layers: it lands in MinIO (object store), gets cataloged in `js_files`, gets semantically indexed as a thought in `thoughts`, and gets section-chunked into `js_chunks` with per-chunk thought embeddings.

---

## 2. File Management

### Object Store + Catalog Duality

Files live in two places simultaneously and must stay in sync:

- **MinIO** (via S3 API): raw bytes, content-addressed by a hierarchical `storage_key` (e.g., `applications/2026-05-15-acme-ae/notes.md`). MinIO is the authoritative byte store.
- **`js_files`** (Postgres): catalog row per file with `storage_key`, `content_type`, `file_size`, `thought_id` (FK to thoughts), `thought_category`, and timestamps. `js_files` is the queryable index.

**Key invariant:** Direct MinIO writes bypass `js_files` and thought capture — the file becomes invisible to semantic search. This is a hard-stop forbidden fallback. The only write path is through `uploadFileCore`.

### Key Convention

Keys mirror the local filesystem hierarchy relative to the applicant data directory:

```
applications/<folder>/notes.md
applications/<folder>/resume.pdf
profiles/presales-se/presales-se-CONTENT.md
search/2026-06-15-presales-se-summary.md
```

This mirrors-path design means a key uniquely identifies both the file's object-store location and its semantic role in the domain model.

### Upload Transaction Sequence

`uploadFileCore` is the single write path — called by both the MCP tool and the REST API:

1. Decode bytes (base64 for binary, UTF-8 for text)
2. Check `js_files` for existing `thought_id` (saves old ID for orphan cleanup)
3. PUT bytes to MinIO
4. Derive `UploadContext` from key prefix (is it an `applications/`, `profiles/`, `search/`, or `docs/` file? If application, what's its status and company?)
5. Extract text as Markdown (type-specific, described below)
6. Infer `thought_category` via Haiku (optional — no-op if `ANTHROPIC_API_KEY` absent)
7. Capture full-document thought in `thoughts` table (embedding + metadata)
8. Upsert `js_files` row with `thought_id`
9. Delete old orphaned thought if `thought_id` changed
10. Chunk and index sections in `js_chunks` (Phase 2)

Every step is best-effort around thought capture and chunking — a failed embedding or chunk write does not fail the upload. MinIO write and `js_files` upsert are the atomic core.

### Upload Transport: MCP Tool vs REST API

Two transports, same backend function (`uploadFileCore`):

| File type | Transport |
|---|---|
| Text files (`.md`, `.json`, `.txt`) ≤ ~50KB | MCP tool (`upload_file`) — JSON-RPC parameter |
| Binary files (PDF, images) | REST API (`PUT /api/v2/files/<key>`) — HTTP body |
| Text files > ~50KB | REST API — avoids MCP JSON-RPC size limits |

The split was forced by real incident: a 75KB PDF via MCP = "base64 is too large for the MCP upload parameter." The REST API accepts the payload as a direct HTTP body with no parameter size constraint.

---

## 3. Text Extraction Pipeline

Before chunking and embedding, files are converted to clean Markdown. The extraction path is type-specific:

| Content type | Extraction method |
|---|---|
| `text/markdown`, `text/plain`, `application/json` | Pass through directly |
| `text/html`, `application/xhtml+xml` | DOM walk → markdown (custom `domToMarkdown`) |
| `application/pdf` | **First try:** Haiku API with document block → returns markdown + thought_category in one call. **Fallback:** `unpdf` plain text extraction |
| DOCX (`vnd.openxmlformats-officedocument...`) | `mammoth` with heading style map (`Heading 1/2` → `##`, `Heading 3` → `###`) |
| Other binary | null (no extraction, no chunking) |

The PDF path is the most sophisticated: Haiku receives the raw PDF as a base64 document block alongside a prompt that asks for both a `thought_category` label and the full document as structured markdown. This is a single LLM call that replaces both extraction and classification.

### Thought Category Inference

For non-PDF files, a second Haiku call classifies the document from a fixed vocabulary:

```
jd_analysis | fit_assessment | domain_connection | company_research
resume_strategy | interview_prep | meeting_notes | email | exercise
application_event | achievement
```

Context is derived from the key prefix (directory type, application status, company name, profile slug) and is included in the prompt alongside a 2,000-character content snippet. The output is a single snake_case token.

---

## 4. Chunking Strategy

```typescript
export function chunkMarkdown(text: string): MarkdownChunk[] {
  const MAX_CHUNK = 8000;  // chars
  const MIN_CHUNK = 30;    // skip tiny sections
  const PARA_SPLIT_SIZE = 1500;  // trigger paragraph-split for headerless blobs
  ...
}
```

### Algorithm

1. **Split on H2 boundaries** (`## ` at start of line). Each `##` section becomes one chunk, including its header.
2. **Oversized sections** (> 8,000 chars) are further split by paragraph (`\n\n+`). Continuation chunks get titles like `"Requirements (continued 1)"`.
3. **Headerless blobs** (verbatim JD files with no `##` headers) are paragraph-split at 1,500 chars even if under 8,000 — prevents one giant blob from swamping the embedding.
4. **Flat text** (PDFs with no paragraph breaks, only single newlines) falls back to line-by-line splitting.
5. **Minimum size filter:** sections < 30 chars are dropped.

### Why H2-boundary?

H2 sections are the natural semantic unit in this domain's markdown conventions. A `notes.md` has `## Fit Assessment`, `## Domain Connection`, `## Requirements Coverage`. Chunking at H2 means each chunk is a standalone answerable question: "what's the fit assessment for this role?" maps cleanly to one chunk rather than requiring the model to parse a 5,000-word document.

### Per-Chunk Thought Capture

After chunking, each chunk is independently captured as a thought:

```typescript
thoughtId = await captureThought(chunk.content, {
  type: "file-chunk",
  storage_key: storageKey,
  section_title: chunk.title,
  section_index: chunk.index,
});
```

This gives each chunk its own embedding vector. The `js_chunks` row links `storage_key → file_id → thought_id`, enabling both file-scoped queries (`WHERE storage_key LIKE $prefix`) and cross-file vector search.

**Idempotency:** On re-upload, the chunker first deletes all existing `js_chunks` rows for that key and their orphaned thought rows before re-inserting. This makes re-uploads clean.

---

## 5. Search Strategy

Three search modes, different use cases:

### Mode 1: Semantic Thought Search (`search_thoughts` / `search_applications_semantic`)

Full-document-level search. Queries the `thoughts` table directly via `match_thoughts()` (pgvector cosine similarity). Threshold: 0.4 similarity. Returns the whole document content as captured — useful for "which applications mention fintech compliance?" or "find all notes where I discussed salary expectations."

```sql
SELECT id, content, metadata, 1-(embedding <=> $query_emb) AS similarity
FROM thoughts
WHERE 1-(embedding <=> $query_emb) >= 0.4
ORDER BY embedding <=> $query_emb LIMIT $n
```

For large documents (> 25,000 chars), a Haiku summarization call produces a shorter text for embedding — the summary is what gets vectorized, not the full content.

### Mode 2: Section-Level Chunk Search (`search_chunks_semantic`)

The critical retrieval tool. Queries `js_chunks` joined to `thoughts` for vector similarity:

```sql
SELECT c.storage_key, c.section_title, c.section_index, c.content,
       (t.embedding <=> $query_emb) AS similarity
FROM js_chunks c
JOIN thoughts t ON c.thought_id = t.id
WHERE ($prefix IS NULL OR c.storage_key LIKE $prefix || '%')
  AND (t.embedding <=> $query_emb) < 0.6
ORDER BY similarity ASC LIMIT $n
```

Scoped by `storage_key_prefix` — can be restricted to one application folder or one profile, or run across the entire corpus. Returns section title + content, not just a document pointer. This is what makes "what does my notes.md say about domain connection for the Middesk role?" work without loading the full file.

### Mode 3: Cross-App Pattern Matching (`find_similar_applications`)

Finds applications with similar JDs or requirements by embedding the query against the `js_chunks` table filtered to JD and notes files. Used for "find roles similar to the Stripe AE I liked" — surfaces structurally similar opportunities across the pipeline.

### Mode 4: Structured Query (`get_pipeline`, `get_application`)

Plain SQL with parameterized filters on `js_applications` joined to `js_companies` and `js_profiles`. Handles status filters, date ranges, priority ordering, follow-up dates. No embeddings — purely relational. The text identifier path also supports fuzzy company/role substring matching and a `Company · Role` separator syntax for disambiguation.

### Mode 5: Text Search (`/ob1/rest/search?mode=text`)

`ILIKE '%query%'` on `thoughts.content`. Cheap, exact, useful for known strings like specific company names or quoted phrases when semantic similarity isn't needed.

---

## 6. Knowledge Graph Layer

Three tables, separate from but linked to the thoughts system:

```
entities:  (entity_type, canonical_name, normalized_name, aliases, metadata)
edges:     (from_entity_id, to_entity_id, relation, support_count, confidence, thought_id)
thought_entities: (thought_id, entity_id, mention_role, confidence, source)
```

In the job-search use case, the knowledge graph captures **skill provenance**:

```typescript
create_knowledge_edge(
  from_entity_type='project',
  from_entity_name='<achievement title>',
  relation='demonstrates',
  to_entity_type='tool' | 'topic',
  to_entity_name='<skill name>',
  metadata={source: 'job_search', profile_slug: '...'}
)
```

This lets you ask: "which achievements demonstrate Kubernetes?" (`get_entity_neighbors`) or "traverse from this role to all required skills" (`traverse_knowledge_graph`). Composite indexes on `(relation, from_entity_id)` and `(relation, to_entity_id)` make both directions efficient.

The `thought_id` field on edges and `thought_entities` creates evidence chains: an edge can be traced back to the thought that generated it.

---

## 7. Ingest Dedup and Audit Trail

### Position Audit (`js_ingested_positions`)

Every job position encountered during a search run gets a row — whether fit, no-fit, duplicate, or fetch-failed. This is an append-only audit log, not a live state table.

Dedup runs in two tiers:
1. URL exact match on `source_url` (fastest)
2. Case-normalized `(company_name, role_title)` match (catches URL variants)

Repost detection: if a match is found and `first_seen_at` is > 60 days ago, it's flagged as a repost, not a true duplicate.

### Search Run Log (`js_search_runs`)

Each ingest run creates one `js_search_runs` row (UUID primary key) before processing starts, then updates counters (pages fetched, screened, fit, no-fit, fetch-failed) at end. The `summary_key` stores the path to the per-run summary markdown uploaded to OB1.

`js_ingested_positions` FK's to `js_search_runs` via `search_run_id` — you can reconstruct exactly what was seen in any historical run.

---

## 8. Dual-Path Architecture: MCP and REST

The server exposes the same business logic through two surfaces:

- **MCP tools** (`job-search-server.ts` → `registerJobSearchTools()`): Claude Code session access. 35 tools, each a thin adapter over a `*Core()` function.
- **REST API** (`/api/v2/*`): webapp (React) access. Same `*Core()` functions, different transport.

Every core function is exported and called from both paths. This eliminates behavioral divergence between what Claude sees and what the webapp shows.

---

## 9. What Transfers to a Different OB1 Knowledge Map Use Case

The job-search domain specifics are in the `js_*` tables. The transferable patterns are:

**Pattern 1: File catalog + dual-write.**
Any domain that manages structured documents benefits from `domain_files` (catalog) + MinIO (bytes) + `thoughts` (searchable). The catalog gives you queryable metadata (type, size, dates, linked entity ID) without reading the file.

**Pattern 2: H2-boundary chunking + per-chunk embedding.**
Works for any markdown-formatted knowledge base. The `js_chunks` → `thoughts` link pattern generalizes: replace `js_chunks` with `domain_chunks` and the rest is identical. The key insight: chunk at semantic boundaries (headings), not token count. Token-count chunking fragments sentences; heading-boundary chunking preserves meaning units.

**Pattern 3: Document-level + section-level search as separate modes.**
Document-level search answers "which files are about X?" Section-level search answers "what does file Y say about X?" Both are needed; neither replaces the other. Wire them as separate tool calls.

**Pattern 4: Context-derived metadata before embedding.**
The `UploadContext` derivation (what directory is this in? what's the parent entity's status?) enriches the thought metadata at write time, not query time. The `thought_category` label enables metadata-filtered search later. This is the difference between a generic vector store and a contextually-aware one.

**Pattern 5: MCP + REST over shared Core functions.**
The `*Core()` pattern is the right abstraction boundary. The MCP tool is a thin adapter; the REST route is a thin adapter; both call the same function. This means any logic fix applies to both surfaces simultaneously.

**Pattern 6: Knowledge graph for provenance.**
Use `entities` + `edges` + `thought_entities` to record where facts came from (which thought/document produced which edge). The graph traversal tools (`get_entity_neighbors`, `traverse_knowledge_graph`) then let you answer "what evidence supports this claim?" — useful in any research or learning domain.

**Things that are domain-specific and must be replaced:**
The `js_applications`, `js_profiles`, `js_companies`, `js_interviews`, `js_contacts`, `js_search_runs`, and `js_ingested_positions` tables are job-search-specific state machines and audit trails. For a different use case, replace these with the corresponding domain object model. The `thought_category` vocabulary is also domain-specific — replace with whatever classification makes sense for the new domain.

The OB1 core (thoughts + pgvector + knowledge graph) plus the chunking and dual-search pattern is the portable foundation. Everything in `js_*` is the domain skin on top.
