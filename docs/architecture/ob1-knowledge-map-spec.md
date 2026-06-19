# OB1 Knowledge Map — Design Spec

**Branch:** `feat/ob1-knowledge-map`  
**Status:** In implementation (Phase 1–2)

## Problem

Job-search workflows currently treat application knowledge as files:
- `notes.md` is a monolithic document that grows unbounded and is re-read wholesale on each interview prep session
- Profile updates write only to `CONTENT.md` — no graph of skills/companies/people is built
- Cross-application learning (`find_similar_applications`) uses document-level semantic similarity only — no entity-level reasoning

## Solution

Capture every piece of application knowledge as an **OB1 thought** tagged with job-search metadata. OB1's existing entity extraction worker automatically builds a graph of skills, companies, people, and requirement themes. `notes.md` becomes a **generated view** from those thoughts rather than the authoritative document.

---

## Thought Metadata Schema

Every job-search thought uses this metadata structure:

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

**thought_category values:**

| Category | When captured | Contains |
|---|---|---|
| `jd_analysis` | `process-jd` Step 5 (fit and no-fit) | Extracted requirements, role signals, key qualifications |
| `fit_assessment` | `process-jd` Step 5 (fit and no-fit) | Score (1–10), verdict, per-requirement reasoning, Hard Stop flags |
| `domain_connection` | `create-application` Step 4a | Four-source connection narrative per company-descriptors policy |
| `company_research` | `create-application` Step 4b | Business model, product, market context, key initiatives |
| `resume_strategy` | `create-application` Step 4c | Tailoring rationale, emphasis priorities for this application |
| `interview_prep` | `interview-prep` skill after generating prep | Full prep brief for a specific stage; metadata includes `stage_name` |
| `meeting_notes` | Manual capture | Notes from recruiter/panel calls |
| `email` | Manual capture | Relevant email content |
| `exercise` | Manual capture | Exercise definition and/or submission |
| `application_event` | Manual capture | Status changes, decisions, learnings |
| `achievement` | Profile maintenance | Individual achievement text; no `application_id`, has `profile_slug` |

For `interview_prep`, add `"stage_name": "<stage>"` to metadata.  
For `achievement`, omit `application_id` and `application_folder`.

---

## Application Folder Structure (new model)

```
applications/YYYY-MM-DD-company-role/
├── notes-index.md          ← PRIMARY: header block + OB1 thought key registry
├── notes.md                ← GENERATED VIEW: rendered from thoughts on demand (or at creation)
├── job-description.md      ← unchanged
├── jd-[company]-[role].md  ← unchanged
├── search-result.json      ← unchanged (if from ingest)
├── [FirstName]_[Role].md   ← unchanged
└── [FirstName]_[Role].pdf  ← unchanged
```

### notes-index.md structure

```markdown
# [Company] — [Role Title]

**Status:** Resume Ready
**Status Detail:** Resume generated 2026-06-18 — not yet submitted
**Date:** YYYY-MM-DD
**Profile:** presales-se (score: 8/10)
**Source:** Google Jobs
**Source URL:** https://...

## OB1 Thought Keys

- jd_analysis: <thought_id>
- fit_assessment: <thought_id>
- domain_connection: <thought_id>
- company_research: <thought_id>
- resume_strategy: <thought_id>
- interview_prep_1 (TechScreen 2026-06-20): <thought_id>
```

**Status** and **Status Detail** in notes-index.md must be kept in sync with `js_applications` (two-file rule — same as was applied to notes.md in v3 and earlier).

The `notes-index.md` header block is the **source of truth** for status display. The full `notes.md` is regenerated from thoughts by `skills/application-summary` when a human-readable view is needed (before PDF review, before interview prep, or on explicit request).

---

## Entity Graph (automatic)

OB1's entity extraction worker runs on every captured thought via the existing async queue. No OB1 code changes are required for Phase 1 or 2.

### Entity types → job-search meaning

| OB1 entity type | Job-search meaning |
|---|---|
| `organization` | Company being applied to |
| `person` | Recruiter, hiring manager, interviewer |
| `tool` | Technical skill, programming language, framework |
| `topic` | Domain, functional area, industry, requirement theme |
| `project` | Achievement or major initiative |
| `place` | Office location / remote context |

### Auto-built edges

| Edge type | Example |
|---|---|
| `uses` | achievement-thought → `uses` → `Kubernetes` |
| `works_on` | person entity → `works_on` → project/achievement entity |
| `related_to` | topic entity → `related_to` → topic entity (requirement clusters) |
| `member_of` | person → `member_of` → organization (auto-inferred from interview context) |
| `co_occurs_with` | any two entities in the same thought (broad fallback) |

Edge `support_count` increments each time the same entity pair appears together across different thoughts — relationship strength accumulates over applications.

### Phase 3: Explicit edges (deferred)

OB1's OB-Graph tools (`create_edge`, `get_neighbors`, `traverse_graph`) exist but are not currently exposed via the open-brain MCP server. Exposing them in `OB1/server/index.ts` will unlock:

| Edge | Meaning |
|---|---|
| company → `requires` → skill | JD explicitly requires this skill |
| achievement → `demonstrates` → skill | Verified achievement proves this skill |

These enable: "which achievements demonstrate the skills CompanyX requires?" — combining entity graph traversal with semantic search.

---

## Relationship to Chunking + Semantic Search

These mechanisms are **complementary, not competing**:

| Mechanism | Best for | Status |
|---|---|---|
| `search_chunks_semantic` on CONTENT.md | Per-requirement fuzzy achievement matching during resume generation | Keep — best mechanism for "find bullets similar to this requirement" |
| `find_similar_applications` | Cross-app domain similarity | Keep — entity graph adds entity-level detail on top |
| OB1 thoughts (new) | Retrieving specific sections of application knowledge by thought ID or semantic query | New path — replaces wholesale notes.md reads in interview prep |
| Entity graph (auto-built) | Relationship queries: "which thoughts share this skill entity?" | New — complements semantic search with precise entity links |
| Whole-document thought (existing) | `search_applications_semantic` document-level search | Unchanged (upload pipeline already captures one whole-doc thought per file) |

**Chunking is not obsolete.** Semantic search answers "what content is similar to this text?" — entity graph answers "what entities are related to X?" They operate at different granularities and serve different query patterns.

---

## Phased Implementation

### Phase 1: Application Thought Capture (workflow/skill changes only)

No OB1 or MCP server changes. Uses existing `mcp__open-brain__capture_thought` and `mcp__open-brain__fetch`.

- `workflows/process-jd/v2.md` — new Step 5: capture jd_analysis + fit_assessment thoughts; create notes-index.md; update notes-index.md with thought IDs
- `workflows/create-application/v4.md` — thought capture for domain_connection, company_research, resume_strategy; update notes-index.md; call application-summary to generate notes.md
- `skills/interview-prep/v3.md` — retrieve thoughts by ID from notes-index.md instead of loading notes.md wholesale; capture interview prep as a thought after generating
- Profile maintenance (CLAUDE.md + applicant-setup.md Phase F) — when adding an achievement to CONTENT.md, also `capture_thought` with `thought_category: achievement` and `profile_slug`

### Phase 2: Generated View (new skill)

- `skills/application-summary/v1.md` — generates notes.md from OB1 thoughts tagged with `application_id`; called automatically at end of `create-application`; also callable on demand

### Phase 3: Explicit Edges (requires OB1 changes — separate branch)

- Expose OB-Graph tools in `OB1/server/index.ts`
- `workflows/process-jd/v3.md` — after processing requirements, create `company requires skill` edges
- Profile maintenance — create `achievement demonstrates skill` edges when adding achievements
- `skills/resume-generation/v4.md` — Phase 0.5 enhancement: entity graph traversal supplements semantic chunk retrieval

---

## Migration

- **New applications** use the new model (notes-index.md primary, thoughts in OB1, notes.md generated)
- **Existing applications** keep their current notes.md as-is — old workflows still function against them
- **Backfill** (deferred): `workflows/atomize-application-notes` will split existing notes.md into thoughts; not in scope for Phase 1–2

---

## Evaluation Criteria

### Phase 1

| Check | Verification method |
|---|---|
| **P1.1** Exactly 3 thoughts captured per fit application (jd_analysis, fit_assessment; domain_connection added by create-application) | `search_thoughts({filter: {application_id: <uuid>}})` returns 2 after process-jd, 5 after create-application |
| **P1.2** jd_analysis content: 200–800 words, contains extracted requirements | Manual review of captured thought content |
| **P1.3** fit_assessment content: includes score (1–10), verdict, Hard Stop flags if triggered | Manual review |
| **P1.4** Entity extraction completes within 5 minutes: company appears as `organization` entity, ≥2 skills as `tool`/`topic` entities | Check entity_extraction_queue status |
| **P1.5** notes-index.md < 40 lines; passes check-md-hygiene.sh | Run `bash scripts/check-md-hygiene.sh` against notes-index.md |
| **P1.6** notes.md generated at end of create-application: all required sections present; Status matches js_applications | Section order check + `get_application` comparison |
| **P1.7** interview-prep/v3 loads thoughts by ID, not wholesale notes.md | Trace which get_file / fetch calls are made during interview prep |
| **P1.8** Idempotency: running process-jd twice on same application_id: thought count unchanged | Run twice, check count before/after |

### Phase 2

| Check | Verification method |
|---|---|
| **P2.1** application-summary generates structurally equivalent notes.md vs. old v3 workflow for same inputs | Side-by-side section comparison |
| **P2.2** Partial thought set handled gracefully: no errors, no empty placeholders | Run with only jd_analysis + fit_assessment thoughts present |
| **P2.3** review-before-PDF gate unchanged | Run full create-application/v4 flow; notes.md exists at Step 6 |

---

## Related Files

- Plan: `$APP_DIR/.claude/plans/ob1-enhancements-and-use-floating-crown.md`
- Overview: `docs/ob1-intelligent-access/overview.md` (Phase 4 section)
- Schema: `docs/ob1-intelligent-access/schema-changes.md` (Phase 4 section)
- Chunking: `docs/ob1-intelligent-access/chunking-design.md` (Phase 3 notes)
- OB1 entity extraction schema: `$OB1_REPO_PATH/schemas/entity-extraction/schema.sql`
- OB1 MCP server: `$OB1_REPO_PATH/server/index.ts`
