# OB1 Intelligent Access — Overview

**Goal:** Reduce context window usage (cost + compression risk) by replacing full-file context loads with targeted semantic retrieval and table-based queries.

**Status:** Phases 1–3 complete (promoted). Phase 4 (Knowledge Map) in implementation on `feat/ob1-knowledge-map`.

## Background

OB1 has pgvector, auto-embeds every uploaded file on upload, and exposes `search_applications_semantic` — but prior to this initiative, that tool had **zero call sites** in any workflow or skill. All workflows performed full `get_file → load entire file into context` regardless of how much of the file was actually needed.

## Three-Phase Rollout

### Phase 1 — Table-First Ingest Overhaul ✓ (drafts complete)

Replace file-based dedup and per-run summary files with Postgres tables and a CSV.

**What changed:**
- New `js_ingested_positions` table — audit trail of every job position seen (fit/no-fit/duplicate/fetch-failed), from both batch ingest and direct chat submissions
- New MCP tools: `check_position_seen` (4-tier dedup), `log_ingested_position`, `get_ingestion_history`
- Local mode: `search/ingested-positions.csv` replaces `seen-jobs.json` + `linkedin-seen-jobs.json`
- Ingest workflows (`search-jobs`, `search-jobs-linkedin`) no longer write per-run summary `.md` files; run stats live in `js_search_runs` + `js_ingested_positions`
- `create-application` workflow now also logs chat-submitted positions to the audit trail
- Repost detection: positions seen >60 days ago flagged as potential reposts

**Files changed:**
- `integrations/ob1/job-search-schema.sql` — added `js_ingested_positions` table
- `integrations/ob1/job-search-tools.ts` — added 3 new tools + updated `registerJobSearchTools`
- `workflows/search-jobs/draft.md` — v2 draft
- `workflows/search-jobs-linkedin/draft.md` — v2 draft
- `workflows/create-application/draft.md` — v3 draft
- `policies/storage-routing/draft.md` — v2 draft (adds ingest routing table rows)
- `MEMORY.md` — updated Job Ingestion section

**Deploy steps:**
1. Apply SQL migration: `kubectl exec -n openbrain openbrain-0 -c postgres -- psql -U postgres -d openbrain < integrations/ob1/job-search-schema.sql`
2. Rebuild + rolling restart `job-search-mcp` image
3. Update Python scripts to support `--no-dedup` flag (search-jobs.py)
4. Validate: run evaluation criteria 1–8 from [../../../.claude/plans/now-we-have-ob1-mossy-quiche.md]
5. Promote drafts to v2/v3

### Phase 2 — Document Chunking + Semantic Retrieval ✓ (drafts complete)

Add H2-section-level chunking to the OB1 upload pipeline. Replace full-file loads in interview-prep and resume-generation with targeted section retrieval via `search_chunks_semantic`.

**Key infrastructure:**
- New `js_chunks` table — one row per H2 section per file
- New chunking pipeline in `job-search-server.ts` — runs on every text file upload
- New MCP tool: `search_chunks_semantic(query, storage_key_prefix, limit)` — returns scored sections
- Backfill script: re-chunks all existing text files in OB1

**Skills updated:**
- `skills/interview-prep/draft.md` — replace `get_file(notes.md)` with `search_chunks_semantic` for 3 required sections; fall back per section for any misses
- `skills/resume-generation/draft.md` — Phase 0.5 semantic retrieval: structural anchors always loaded, per-requirement queries for profile-CONTENT.md sections; fall back to full file if < 3 unique sections

**Context reduction target:** < 40% of original file size on average for interview-prep sessions.

### Phase 3 — Structured Metadata + Cross-App Pattern Matching ✓ (drafts complete)

Surface relevant past applications during new JD processing and resume generation.

**Key infrastructure:**
- `js_applications` extended with `domain_connection TEXT`, `domain_tags TEXT[]`, `jd_requirements JSONB`
- New MCP tools: `update_application_fields` (store structured metadata), `find_similar_applications` (semantic search across past applications by domain via Phase-2 chunk embeddings of notes.md)
- `workflows/process-jd/draft.md` (v2): Haiku output extended with `domain_tags` + `jd_requirements_structured`; Step 4.5 calls `update_application_fields`
- `workflows/create-application/draft.md`: Step 4a stores `domain_connection` after Domain Connection notes expansion
- `skills/resume-generation/draft.md`: Phase 0.75 calls `find_similar_applications` to check domain positioning consistency

**Context impact:** Zero direct context reduction; enables cross-application reasoning without file loads. `find_similar_applications` uses Phase 2 chunk embeddings — no new embedding work needed.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Chunking granularity | H2 section level | Natural boundary for notes.md and profile-CONTENT.md; returns coherent sections not fragments |
| Dedup tiers | 4-tier (URL → exact company+role in ingest history → exact in pipeline → fuzzy prefix) | Belt-and-suspenders; catches direct submissions and reposted jobs |
| Repost window | 60 days | Job may legitimately reopen after 2 months; < 60 days likely a duplicate posting |
| Local mode chunking | Fall back to full file read | No vector DB in local mode; degraded gracefully |
| role-achievements.md in resume | Not a chunking target | Upstream maintenance source; not read during resume generation |
| `js_ingested_positions` PK | UUID (matches all other js_* tables) | Consistency; no bigserial special cases |

### Phase 4 — Knowledge Map via OB1 Thoughts (implemented on `feat/ob1-knowledge-map`)

Capture every piece of application knowledge as an OB1 thought. OB1's entity extraction worker automatically builds a graph of skills, companies, people, and requirement themes. `notes.md` becomes a generated view from those thoughts rather than the authoritative document.

**What changed:**
- `notes-index.md` replaces `notes.md` as the primary per-application file — lightweight header block + OB1 thought ID registry (~20 lines)
- `notes.md` becomes a generated view rendered on demand by the new `skills/application-summary/v1` skill
- `workflows/process-jd/v3` adds Steps 5–6: capture `jd_analysis` + `fit_assessment` thoughts; create `company→requires→skill` edges for each JD requirement
- `workflows/create-application/v4` captures `domain_connection`, `company_research`, and `resume_strategy` thoughts
- `skills/interview-prep/v3` retrieves thoughts by ID instead of loading notes.md wholesale
- `skills/resume-generation/v4` adds Phase 0.25: graph traversal enrichment before content retrieval
- Profile maintenance: when adding an achievement, `capture_thought` with `thought_category: achievement`; create `achievement→demonstrates→skill` edges

**New MCP tools (Phase 4 explicit edges):** `create_knowledge_edge`, `get_entity_neighbors`, `traverse_knowledge_graph` — registered in job-search-mcp server; no OB1 source changes required.

**Automatic thought_category inference + binary file extraction:** Every file upload goes through `extractAsMarkdown()` before thought capture and chunking. Type-specific converters produce best-effort markdown with headings preserved:
- **HTML** → `domToMarkdown()` DOM walk (H1/H2 → `## `, H3/H4 → `### `, LI → `- `)
- **DOCX** → `mammoth.convert()` with Word heading style map (Heading 1/2 → `## `)
- **PDF** → `extractMarkdownViaHaiku()`: single Haiku call returns both markdown AND `thought_category` (one API call, not two); falls back to `unpdf` plain text when `ANTHROPIC_API_KEY` absent
- **text/markdown, text/plain** → pass through

The new `capture_thought` MCP tool (`mcp__job-search__capture_thought`) exposes the `captureThoughtFn` callback with structured metadata fields (`application_id`, `thought_category`, `company`, `profile_slug`, etc.). Prefer it over `mcp__open-brain__capture_thought` in job-search sessions — it passes metadata as typed fields instead of YAML embedded in content.

Inferred category stored in `js_files.thought_category` and in the thought metadata. Chat panel file attachments use `useLocation()` to pass application folder as context.

**Context impact:** Significant for interview-prep — replaces full notes.md load with targeted thought fetches by ID. Upload pipeline now produces fully indexed, classified thoughts for all file types including PDFs and DOCX, with section-level chunks that carry `section_title` from headings in DOCX, HTML, and PDF content.

**Files changed:**
- `workflows/process-jd/v2.md` — new Step 5 (thought capture + notes-index.md)
- `workflows/create-application/v4.md` — thought capture + application-summary call
- `skills/interview-prep/v3.md` — thought-based retrieval
- `skills/application-summary/` — new skill
- `docs/architecture/ob1-knowledge-map-spec.md` — full design spec

**Related:** `docs/ob1-intelligent-access/chunking-design.md` §Relationship to Phase 4

## Related Files

- Plan (Phases 1–3): `$APP_DIR/.claude/plans/now-we-have-ob1-mossy-quiche.md`
- Plan (Phase 4): `$APP_DIR/.claude/plans/ob1-enhancements-and-use-floating-crown.md`
- Spec (Phase 4): `$APP_DIR/docs/architecture/ob1-knowledge-map-spec.md`
- Schema: `integrations/ob1/job-search-schema.sql`
- Tools: `integrations/ob1/job-search-tools.ts`
- Server: `integrations/ob1/job-search-server.ts`
- Storage routing policy: `policies/storage-routing/`
