---
name: hermes-architecture-phases
description: Hermes architecture migration — phases 1+2 landed 2026-06-12 on branch hermes; phase 3 (Temporal) and phase 4 (learning loop) decisions already made but not built
metadata: 
  node_type: memory
  type: project
  originSessionId: 6489cf99-c8c3-45a7-b96b-8e554fae1b9b
---

The "rigorous development process" architecture (Temporal + OB1 + versioned skills + runtime) was implemented in phases on branch `hermes`. Phases 1+2 landed 2026-06-12 (commits 38ce666..8cfb848): skills/policies/workflows directories with skill.yaml manifests + registry, runtime package at webapp/backend/runtime/ (registry/composer/ClaudeRunnerAdapter/HermesAdapter/events), /api/skills endpoints, /skill slash command, CLAUDE.md cutover.

**Deferred decisions already made by the user (don't re-ask):**
- Phase 3: Workflow API + Temporal `CreateApplication` workflow — Temporal **self-hosted on the existing openbrain k8s cluster**, **Python SDK**; activities wrap `adapter.run_skill()` directly (runtime is FastAPI-free by design) or call `POST /api/skills/{name}/run`; `workflows/*/skill.yaml` gains a `steps:` list mapping 1:1 to Temporal steps
- Phase 4: OB1 audit-event table (`js_audit_events` in integrations/ob1/job-search-schema.sql) + correction→skill-update→regression-test→promote learning loop; `runtime/events.py` is the single chokepoint to swap backends; `run_id` joins runs↔corrections↔promotions
- Runtime: **both adapters behind the AgentAdapter protocol** — Claude primary, Hermes experimental (no documented headless mode as of 2026-06; gated behind HERMES_HEADLESS_CMD)

Deferred content migrations: /ingest + /ingestLI full workflow extraction; applicant-setup.md as a workflow. Original plan file: ~/.claude/plans/implement-the-new-architecture-kind-quasar.md.
