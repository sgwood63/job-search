# OB1 Intelligent Access — Overview

**Goal:** Reduce context window usage (cost + compression risk) by replacing full-file context loads with targeted semantic retrieval and table-based queries.

**Status:** Phase 1 complete (drafts). Phases 2–3 in progress.

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

## Related Files

- Plan: `$APP_DIR/.claude/plans/now-we-have-ob1-mossy-quiche.md`
- Schema: `integrations/ob1/job-search-schema.sql`
- Tools: `integrations/ob1/job-search-tools.ts`
- Server: `integrations/ob1/job-search-server.ts`
- Storage routing policy: `policies/storage-routing/`
