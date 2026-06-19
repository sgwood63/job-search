# Hermes Architecture — Phase 3/4 Roadmap

Design detail for the deferred phases, written 2026-06-12 while the phase 1/2 context was fresh. Decisions here were made during the phase 1/2 effort and should not be re-litigated without cause. Companion docs: [source design PDF](2026-06-job-search-architecture-evolution.pdf), [as-approved phase 1/2 plan](hermes-phase-1-2-plan.md), [implementation record](hermes-phase-1-2-implementation.md).

**Decided:** Phase 3 = Workflow API + Temporal, **self-hosted on the existing openbrain k8s cluster**, **Python SDK**. Phase 4 = OB1 audit-event table + correction → skill-update → regression-test → promote learning loop. Runtime stays behind the `AgentAdapter` protocol (Claude primary, Hermes experimental).

---

## Phase 3 — Workflow API + Temporal

Goal (from the design doc): job search is a long-running process with pauses, retries, state transitions, and follow-ups — Temporal owns durable workflow state; the runtime owns skill execution; OB1 owns memory.

### 3.1 Temporal deployment

- Deploy Temporal server + Web UI into the existing `openbrain` namespace. Manifests in `integrations/ob1/k8s/` following the patterns of `openbrain.yml` / `job-search.yml` (ClusterIP services, `openbrain-secret` for credentials, env via configmap).
- Persistence: the existing PostgreSQL instance, in a **separate `temporal` database** (Temporal's schema tooling manages its own tables; keep it out of the `openbrain` DB that holds `js_*` tables).
- Expose the Temporal UI through the existing nginx Ingress (e.g. `/temporal` path), same pattern as `/ob1`, `/job-search`, `/minio`.
- Connection env vars (`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`) go in `.env.services` (service credentials, never sourced by Claude Code sessions) and the webapp configmap.

### 3.2 Worker

- **Same Docker image as the webapp** — it already ships `skills/`, `policies/`, `workflows/`, and `webapp/backend/runtime/` (see webapp/Dockerfile). New entrypoint `webapp/backend/worker.py`; the k8s Deployment overrides the container command.
- Activities import the runtime package directly — it is FastAPI-free by design (stdlib + pydantic + yaml + dotenv only):
  ```python
  reg = load_registry(APP_DIR)
  resolved = resolve(reg, skill_name, mode='webapp')      # pinned-only, same guarantee as /api/skills
  prompt = compose_prompt(resolved, reg, 'webapp')
  result = await adapter.run_skill(SkillRunRequest(...), prompt)
  ```
- Adapter selection mirrors the webapp: `RUNTIME_ADAPTER` env, `ClaudeRunnerAdapter` default. In-cluster, the worker pod needs the claude-runner sidecar pattern (or the claude binary in-image, as the webapp image already has) plus `ANTHROPIC_API_DEPLOYMENT_KEY`.
- Add `temporalio` to `webapp/backend/requirements.txt`. The `temporal-developer` skill (available in Claude Code) covers SDK specifics — workflows, activities, signals, testing.

### 3.3 `CreateApplication` workflow

Maps 1:1 to `workflows/create-application/` (pinned version). Activity boundaries:

| # | Activity | Wraps | Notes |
|---|---|---|---|
| 1 | `fetch_jd` | fetch fallback chain (WebFetch equivalent / `scripts/fetch-jd.py`) | retry on transient network errors; exit-code-2 (auth) and exit-code-3 (closed) are business outcomes, not retryable failures |
| 2 | `screen_jd` | skill `jd-evaluation` via runtime | Haiku-class model; returns verdict/facts/profile |
| 3 | `persist_jd` | `upsert_company` + `create_application` + `upload_file` x3 (OB1 REST/MCP) | idempotent via folder slug |
| 4 | `generate_resume` | skill `resume-generation` via runtime | fit branch only; long timeout |
| 5 | *(signal wait)* | — | **human review gate**: the phase 1/2 "stop and wait for approval" becomes a `wait_condition` on an `approve_resume` signal (with edits payload); timer for follow-up nudges |
| 6 | `finalize_pdf` | PDF pipeline + REST upload per storage-routing policy | after approval signal |
| 7 | `update_tracker` | `update_application_status` | two-file rule handled inside the workflow content |
| 8 | `record_events` | `runtime.events.record_event` | one `skill_run` event per skill activity, joined by `run_id` |

- No-fit path short-circuits after activity 3 (brief notes + closed status).
- Workflow ID convention: the application folder slug (`2026-06-12-company-role`) — natural idempotency/dedup.
- All skill executions are **webapp mode (pinned)** — same guarantee as `POST /api/skills/{name}/run`.

### 3.4 `steps:` schema addition to workflow manifests

Add to `workflows/*/skill.yaml` a declarative step list the Temporal definition mirrors (and the registry test validates):

```yaml
steps:
  - {name: screen,   skill: jd-evaluation,     inputs: [jd_content], outputs: [verdict, matched_profile]}
  - {name: persist,  tool: ob1.create_application, inputs: [verdict, extracted_facts]}
  - {name: resume,   skill: resume-generation, when: "verdict == fit", inputs: [application_folder, matched_profile]}
  - {name: review,   gate: signal/approve_resume}
  - {name: tracker,  tool: ob1.update_application_status}
```

Extend `webapp/backend/runtime/registry.py` validation + `tests/test_runtime_registry.py`: every `steps[].skill` must exist in the registry. The `inputs`/`outputs` lists in skill manifests become typed activity payloads (pydantic models in `runtime/models.py`).

### 3.5 Workflow API surface (FastAPI, same app)

- `POST /api/workflows/create-application` — body `{jd_source}`; starts the workflow, returns `{workflow_id}`
- `GET /api/workflows/{workflow_id}` — status + condensed history (per-activity status, current gate)
- `POST /api/workflows/{workflow_id}/signal/approve-resume` — body `{approved, edits?}`
- Webapp UI later adds a "Process JD" action calling these instead of a chat session.

### 3.6 Suggested commit sequence

1. k8s manifests + Temporal reachable in-cluster (UI via Ingress)
2. `worker.py` + one trivial workflow (health/echo through the runtime) + worker Deployment
3. `steps:` schema + registry validation + tests
4. `CreateApplication` workflow + activities + Temporal-SDK tests (time-skipping test env)
5. Workflow API endpoints + tests
6. Webapp UI wiring

---

## Phase 4 — Audit events + learning loop

Goal (from the design doc): corrections become versioned skill changes, gated by regression tests — not vague memory notes. Every OB1 write carries who/what, source evidence, timestamp, workflow context, skill version, confidence/review status.

### 4.1 `js_audit_events` table

Add to `integrations/ob1/job-search-schema.sql` (DDL sketch):

```sql
CREATE TABLE js_audit_events (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind            TEXT NOT NULL CHECK (kind IN ('skill_run','correction','promotion')),
  run_id          TEXT NOT NULL,            -- joins runs <-> corrections <-> promotions
  skill           TEXT NOT NULL,
  version         TEXT,                     -- skill version involved
  actor           TEXT,                     -- 'webapp' | 'interactive' | 'workflow:<id>' | user
  workflow_id     TEXT,                     -- Temporal workflow, when applicable
  payload         JSONB NOT NULL DEFAULT '{}',
  source_evidence TEXT                      -- OB1 thought id / file key backing the event
);
CREATE INDEX ON js_audit_events (skill, kind, ts);
CREATE INDEX ON js_audit_events (run_id);
```

`webapp/backend/runtime/events.py` is the **single chokepoint** — add an OB1 backend (REST insert via the job-search server) selected by `DATA_BACKEND`, JSONL stays as the local fallback. Call sites (`main.py` run/corrections endpoints, future worker activities) do not change. Migrate any accumulated `.runtime-events/*.jsonl` on cutover.

### 4.2 Correction → draft flow

1. Corrections accumulate per skill via `POST /api/skills/{name}/corrections` (webapp) and interactive feedback (which CLAUDE.md already routes toward `/skill draft`).
2. A review pass — initially manual (`/skill list` could surface correction counts; later an automated proposer) — clusters corrections and opens a draft via the existing `/skill draft` flow.
3. The draft rationale header cites the correction `run_id`s it addresses, giving promotions a traceable evidence chain: correction events → draft → promotion event → new pinned version.

### 4.3 Regression testing (the doc's "regression test runs against prior JDs")

- Fixtures: `webapp/backend/tests/fixtures/regression/` — anonymized prior JDs + expected outcomes (verdict, matched profile, key resume properties like section order and no-percentage compliance).
- A gated pytest suite (env-gated like `RUNTIME_SMOKE=1`, since it makes real model calls) runs each fixture through **draft and pinned** versions via the runtime and diffs outcomes; deterministic properties asserted, generative properties diffed for human review.
- Extend the `/skill promote` gate (.claude/commands/skill.md step 2) to include the regression suite when fixtures exist for that skill.

### 4.4 Boundary (from the design doc, keep it)

- Runtime/Hermes may **coordinate content and workflow-memory updates** through approved OB1 tools, with audit events.
- Runtime/Hermes only **proposes** structural changes (new entity/relationship types, indexing rules, storage policies) — humans + migrations apply them.

---

## Pickup checklist for a future session

1. Read this doc, then [hermes-phase-1-2-implementation.md](hermes-phase-1-2-implementation.md) (commit map + deviations), then skim `webapp/backend/runtime/` (~8 small modules) and one `workflows/*/skill.yaml`.
2. Existing seams to build on:
   - `webapp/backend/runtime/` — FastAPI-free; import from workers as-is
   - `webapp/backend/runtime/events.py` — swap backend here only (4.1)
   - `POST /api/skills/{name}/run` + `/corrections` in `webapp/backend/main.py` — alternative integration path and correction intake
   - `webapp/Dockerfile` — image already ships skills + runtime; add worker entrypoint only
   - `integrations/ob1/k8s/` — manifest patterns; `integrations/ob1/job-search-schema.sql` — schema home
   - `run_id` (`runtime/models.py:new_run_id`) — the join key everywhere
3. Phase 3 before phase 4 (the learning loop wants workflow context on events), but 4.1 (the table + events backend) can land independently any time.
4. Verify against the live cluster before starting: `kubectl get pods -n openbrain` and the deployment test suite `integrations/ob1/tests/test-deployment.sh`.
