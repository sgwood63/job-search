# Hermes Architecture Phases 1–2 — Implementation Record

Implemented 2026-06-12 on branch `hermes`. Source design doc: [2026-06-job-search-architecture-evolution.pdf](2026-06-job-search-architecture-evolution.pdf). As-approved plan: [hermes-phase-1-2-plan.md](hermes-phase-1-2-plan.md).

## Commit map

| Commit | What landed |
|---|---|
| `38ce666` | Scaffold: `skills/` (jd-evaluation, resume-generation, cover-letter, interview-prep), `policies/` (factuality, evidence-grounding, company-descriptors, storage-routing), `workflows/` (create-application, prepare-interview) — 22 files, content migrated verbatim, originals untouched |
| `7ccddc6` | Runtime package `webapp/backend/runtime/` (models, registry, composer, adapter protocol, claude_exec extracted from main.py, ClaudeRunnerAdapter, events) + 31 tests |
| `3964050` | `/api/skills*` endpoints, FakeAdapter API tests, Dockerfile ships skills/policies/workflows, `RUNTIME_ADAPTER`/`RUNTIME_ALLOW_DRAFT` in `.env.example` |
| `a9e2981` | Interactive cutover: `/skill` command; CLAUDE.md "Skills Are the Source of Truth"; workflow.md → pointer; 8 migrated `memory/feedback_*` files → stubs; MEMORY.md index rewritten; interview.md thinned; ingest rubric references |
| `55175a1` | Public docs: DEVELOPER-README (tree + rule-change flow), USER-GUIDE (`/skill`), webapp/README (endpoints + env), README/QUICK-START |
| `8cfb848` | Experimental HermesAdapter + live smoke test (`RUNTIME_SMOKE=1`) |
| `f5ee40e` | Memory note recording phase 3/4 decisions |

## What exists now

- **Versioned skills**: each entry is a directory with `skill.yaml` (kind, status, `pinned`, `latest`, policies, changelog) + immutable `vN.md` files; `skills/registry.yaml` enumerates membership; format spec in `skills/README.md`. Change flow: `/skill draft <name>` → edit/exercise → `/skill promote <name> [--pin]` (pytest-gated, one manual commit).
- **Two execution modes**: interactive resolves draft-first then pinned; webapp resolves pinned-only (`draft` refused with 403 unless `RUNTIME_ALLOW_DRAFT=true`).
- **Runtime** (`webapp/backend/runtime/`): FastAPI-free by design (stdlib + pydantic + yaml + dotenv) so phase-3 Temporal workers can import it directly. Composer assembles skill body + manifest policies (deduped, manifest order) into one system prompt with a mode/DATA_BACKEND header; warns above 60KB.
- **Adapters** behind the `AgentAdapter` protocol: `ClaudeRunnerAdapter` (headless `claude -p --output-format stream-json`, local subprocess or runner sidecar via `CLAUDE_RUNNER_URL` — `webapp/runner/runner.py` unchanged) and `HermesAdapter` (experimental, see below).
- **Endpoints**: `GET /api/skills[?reload=1]`, `GET /api/skills/{name}`, `POST /api/skills/{name}/run` (`?stream=1` for NDJSON), `POST /api/skills/{name}/corrections`.
- **Events** (`runtime/events.py`): single chokepoint, JSONL to `$APP_DIR/.runtime-events/` (gitignored); kinds `skill_run | correction | promotion`; `run_id` joins them.
- **Tests**: 148 passed / 1 skipped, including real-repo registry anti-drift validation and md-hygiene over all skill markdown.

## Deviations and findings vs. the plan

1. **Hermes Agent has no documented headless mode** (verified against hermes-agent.org and the NousResearch/hermes-agent README — only `hermes` interactive and `hermes gateway`). The adapter therefore materializes composed prompts as agentskills-standard SKILL.md files under `$HERMES_HOME/skills/job-search-<name>/` and executes only when `HERMES_HEADLESS_CMD` is set to a user-verified command template; otherwise `health()` is False and runs raise `AdapterUnavailable`.
2. **No k8s manifest change needed**: the `init-app-dir` container copies `/app/.` wholesale, so the new directories reach the runner pod once the webapp image ships them.
3. **`pyyaml` added to `webapp/backend/requirements.txt`** (was installed in the venv but undeclared).

## Verification performed

- Full pytest suite green after every commit; existing `test_api.py` unaffected by the claude_exec extraction.
- Live check: backend on a local port — `GET /api/skills` returned all 10 entries with correct kind/pinned/draft state; draft run refused (403); unknown skill 404; corrections endpoint wrote a JSONL event.
- `scripts/check-md-hygiene.sh` clean on all new/modified markdown; pre-commit hook passed on every commit.

## Deferred (decisions made, not built)

> Full design detail for picking these up: [hermes-phase-3-4-roadmap.md](hermes-phase-3-4-roadmap.md).

- **Phase 3 — Workflow API + Temporal**: `CreateApplication` workflow, Temporal **self-hosted on the existing openbrain k8s cluster**, **Python SDK**. Activities wrap `adapter.run_skill()` directly or call `POST /api/skills/{name}/run`; `workflows/*/skill.yaml` gains a `steps:` list mapping 1:1 to workflow steps; `inputs/outputs` become typed payloads.
- **Phase 4 — audit + learning loop**: `js_audit_events` table in `integrations/ob1/job-search-schema.sql`; swap the `events.py` backend without touching call sites; correction → skill-update → regression-test → promote loop using immutable `vN.md` + changelog as before/after pairs.
- **Content migrations**: `/ingest` + `/ingestLI` full extraction into a workflow; `applicant-setup.md` as a workflow.
