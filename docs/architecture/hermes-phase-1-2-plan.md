# Versioned Skills + Agent Runtime (Hermes Architecture, Phases 1–2)

> **Archived plan** — this is the implementation plan as approved on 2026-06-12, executed as commits `38ce666..8cfb848` on branch `hermes`. The source design doc is [2026-06-job-search-architecture-evolution.pdf](2026-06-job-search-architecture-evolution.pdf); what was actually built (including deviations) is in [hermes-phase-1-2-implementation.md](hermes-phase-1-2-implementation.md). Paths have been sanitized to `$APP_DIR`-relative form.

## Context

The approved architecture doc ("Moving to a more rigorous development process") restructures the job-search system so that operational knowledge — previously scattered across `CLAUDE.md`, `workflow.md`, and 15 `memory/feedback_*.md` files — becomes **versioned, testable skills** executed by an agent runtime, instead of vague memory notes. Target layering: Temporal (durable workflow state) → agent runtime → versioned skills/policies → tools → OB1 (durable memory). Two execution modes: **interactive** (may use drafts, propose skill changes) and **webapp** (executes pinned versions only).

**User decisions:**
- Runtime behind an **adapter interface**: ClaudeRunnerAdapter (primary, reuses existing headless-claude plumbing) + HermesAdapter (Nous Research Hermes Agent CLI, thin/experimental, spiked last).
- **Scope = Phases 1+2 only**: repo restructure into skills/policies/workflows with versioning + runtime executing pinned/draft versions. **Deferred:** Phase 3 (Workflow API + Temporal `CreateApplication`, self-hosted on the existing openbrain k8s cluster, Python SDK) and Phase 4 (OB1 audit-event table + correction→skill-update→regression→promote learning loop). Leave clean seams.
- Language: **Python** (matches webapp FastAPI backend + pytest suite).

Repo branch: `hermes` (identical to main at start). All work requires `DEV_MODE=true` (user toggles manually per the DEV_MODE protocol).

## 1. New repo layout — versions as files, not git tags

Files (not tags) because: containers consume the repo via Docker `COPY` (webapp/Dockerfile, runner init-container seed); two versions must be live simultaneously (webapp@v7 + interactive@draft); interactive sessions read/diff versions with plain file tools.

```
skills/
  registry.yaml                  # enumerates all entries (name, kind, path) — membership only
  README.md                      # format spec + authoring rules
  jd-evaluation/      { skill.yaml, v1.md }
  resume-generation/  { skill.yaml, v1.md }      # draft.md exists only while drafting
  cover-letter/       { skill.yaml, v1.md }
  interview-prep/     { skill.yaml, v1.md }
policies/
  factuality/           { skill.yaml, v1.md }
  evidence-grounding/   { skill.yaml, v1.md }
  company-descriptors/  { skill.yaml, v1.md }
  storage-routing/      { skill.yaml, v1.md }    # the ob1-routing policy
workflows/
  create-application/ { skill.yaml, v1.md }
  prepare-interview/  { skill.yaml, v1.md }
```

`skill.yaml` (one format for all kinds, discriminated by `kind`):

```yaml
name: resume-generation
kind: skill                  # skill | policy | workflow
description: ...
status: active               # active | experimental | deprecated
pinned: v1                   # what webapp mode executes
latest: v1
policies: [factuality, evidence-grounding, company-descriptors, storage-routing]
inputs:  [application_folder, profile]     # informal contract; typed in phase 3
outputs: [resume_md, evaluation_report]
changelog:
  - {version: v1, date: 2026-06-12, summary: Migrated from memory/feedback_resume_generation.md + CLAUDE.md + workflow.md}
```

Rules: per-skill `skill.yaml` owns pinned/latest/metadata; `registry.yaml` only enumerates (a pytest test enforces 1:1 sync). `vN.md` immutable once committed; all changes go through `draft.md` → promote. Skill markdown keeps the `memory/`-style frontmatter (`name`, `description`).

## 2. Content migration mapping (copy, don't invent)

| New file | Migrated from |
|---|---|
| `skills/jd-evaluation/v1.md` | workflow.md Step 2 (Haiku screen), MEMORY.md screening section, memory/feedback_unknown_company_research.md |
| `skills/resume-generation/v1.md` | memory/feedback_resume_generation.md (minus cover-letter rules), CLAUDE.md Resume Generation + Review-before-PDF, workflow.md resume pipeline, MEMORY.md construction standards |
| `skills/cover-letter/v1.md` | cover-letter rules from feedback_resume_generation.md + cover-letter-only clause of feedback_domain_connection.md |
| `skills/interview-prep/v1.md` | memory/feedback_interview_preparation.md + output structure from .claude/commands/interview.md |
| `policies/factuality/v1.md` | CLAUDE.md No-fabrication + No-unverified-percentages, MEMORY.md Critical Rules |
| `policies/evidence-grounding/v1.md` | source-only-from CONTENT.md/EXPERIENCE-REFERENCE.md rules, role-order verification, content-library-headers rule, project_profiles_directory.md |
| `policies/company-descriptors/v1.md` | memory/feedback_domain_connection.md (four sources) + company-description rule (commit 960eda8) |
| `policies/storage-routing/v1.md` | memory/feedback_ob1_integration.md verbatim + DATA_BACKEND bullet from CLAUDE.md |
| `workflows/create-application/v1.md` | workflow.md steps 1–3 + fit/no-fit branches + notes.md structure; feedback_jd_file_saving.md; feedback_application_tracking.md; feedback_application_status_update.md. References skills by name ("screen via `jd-evaluation`") |
| `workflows/prepare-interview/v1.md` | .claude/commands/interview.md orchestration, invoking skill `interview-prep` |

**Deferred:** `/ingest` + `/ingestLI` (tooling-heavy, work today) — only point their screening rubric at `skills/jd-evaluation`. `applicant-setup.md` untouched (future workflow).

**Fate of originals:**
- Migrated `memory/feedback_*.md` → 3–5 line **pointer stubs** (keep frontmatter so sync-memory.sh/MEMORY.md indexing works; stubs overwrite stale full copies in the synced `~/.claude` memory dir).
- `workflow.md` → ~25-line pointer (file must exist: referenced by docs + hygiene sentinel).
- `CLAUDE.md` → shrink migrated sections to a new short "Skills are the source of truth" section: read the relevant skill before executing; interactive uses `draft.md` when present (announce "using DRAFT <name>"), else pinned; manifest-listed policies are mandatory companion reading. Trigger sections stay, pointing at workflow/skill files. **Keep "four sources" wording** (hygiene sentinel #6 fails on "three sources").
- `.claude/commands/`: all 9 keep names/UX. Only `interview.md` thinned to "execute workflows/prepare-interview"; ingest/ingestLI get a one-line jd-evaluation reference; rest untouched.
- Not migrated (session mechanics stay in `memory/`): feedback_commits, feedback_dev_mode, feedback_doc_maintenance, feedback_model_selection, feedback_session_end, feedback_session_strategy, reference_directories, project_profiles_directory; MEMORY.md rewritten as index.

## 3. Runtime package — `webapp/backend/runtime/`

Lives in the backend (existing pytest suite, runner plumbing, requirements.txt, Docker image). **Lift-out seam:** `runtime/` imports only stdlib + pydantic + yaml + httpx — never `main.py`/`fastapi` — so phase-3 Temporal workers import it unchanged.

```
webapp/backend/runtime/
  models.py          # SkillRunRequest{skill, version?, mode, task, timeout_s},
                     # SkillRunResult{run_id, status, skill, version, adapter,
                     #                output_text, artifacts, transcript, usage}, Artifact, ComposedPrompt
  registry.py        # load_registry(root), resolve(reg, name, version, mode)
                     #   webapp: version or pinned; 'draft' → error (pinned-only guarantee)
                     #   interactive: explicit honored; else draft.md if present; else pinned
  composer.py        # compose_prompt(): header(mode, skill@version, DATA_BACKEND reminder)
                     #   + skill body + manifest policies (same mode rules), deduped, manifest order
                     #   warn >60KB
  adapter.py         # AgentAdapter Protocol: run_skill(req, prompt) -> SkillRunResult; health()
  claude_exec.py     # EXTRACTED from main.py: resolve_claude_binary(), stream_via_runner();
                     #   main.py imports back (chat unchanged)
  claude_adapter.py  # builds `claude -p --dangerously-skip-permissions --output-format stream-json
                     #   --verbose --append-system-prompt <composed>`; local subprocess (cwd=$APP_DIR)
                     #   or POST to runner sidecar when CLAUDE_RUNNER_URL set (runner.py: zero changes);
                     #   parses NDJSON → transcript/output_text; artifact extraction best-effort
  hermes_adapter.py  # experimental: materialize composed prompt as SKILL.md in $HERMES_HOME/skills/,
                     #   invoke hermes CLI headless (flags need spike verification);
                     #   until verified: health()=False, run_skill raises AdapterUnavailable.
                     #   Selected via RUNTIME_ADAPTER=hermes; never default.
  events.py          # record_event(kind, payload) — kinds: skill_run | correction | promotion.
                     #   JSONL to $APP_DIR/.runtime-events/ (local) or upload_file runtime/events/... (ob1).
                     #   Phase-4 seam: backend swaps to js_audit_events without touching call sites.
```

**Webapp endpoints (main.py):**
- `GET /api/skills` (registry listing; `?reload=1` dev reload), `GET /api/skills/{name}` (manifest + versions)
- `POST /api/skills/{name}/run` — `{version?, task}`, mode forced `webapp` (draft only if `RUNTIME_ALLOW_DRAFT=true`); returns SkillRunResult; `?stream=1` streams NDJSON
- `POST /api/skills/{name}/corrections` — `{run_id, correction, context?}` → `record_event('correction', …)` (phase-4 seam)
- Adapter chosen at startup from `RUNTIME_ADAPTER` env (default `claude-runner`).

**Packaging:** add `COPY skills/ policies/ workflows/` to webapp/Dockerfile; verify the runner-pod `/app` init-container seed in `integrations/ob1/k8s/webapp.yml` includes the new dirs.

## 4. Interactive mode — new `/skill` command (`.claude/commands/skill.md`)

```
/skill list                    # registry + pinned/draft status
/skill show <name> [version]
/skill draft <name>            # copy pinned → draft.md with rationale header (needs DEV_MODE=true)
/skill diff <name>             # draft vs pinned
/skill promote <name> [--pin]  # gate: pytest tests/test_runtime_*.py; rename draft.md → v(N+1).md;
                               # update skill.yaml latest+changelog (pinned only with --pin);
                               # commit all files together in ONE manual commit (feedback_commits rule)
```

CLAUDE.md instructs: procedural feedback on migrated areas → propose `/skill draft` + edit draft.md (not the old memory file). DEV_MODE gate applies unchanged to skills/ (intentional human-in-the-loop; a draft.md carve-out in check-dev-mode.sh is explicitly deferred).

## 5. Tests (`webapp/backend/tests/`, existing conftest conventions)

- `test_runtime_registry.py` — fixture parsing + **real repo registry validation**: every entry has dir+manifest, pinned file exists, pinned≠draft, referenced policies exist, registry⇄dirs 1:1.
- `test_runtime_resolution.py` — mode resolution rules incl. error cases.
- `test_runtime_composer.py` — composition order, dedup, header content.
- `test_runtime_claude_adapter.py` — stub `claude` shell script emitting canned stream-json (injected via `CLAUDE_BINARY`); NDJSON mapping, error/timeout; runner-URL path against in-test HTTP server.
- `test_api_skills.py` — TestClient + FakeAdapter monkeypatch (mirrors `mock_ob_rest` pattern): listing, run, mode forcing, corrections event written.
- `test_skill_content_hygiene.py` — run `scripts/check-md-hygiene.sh` over all skills/policies/workflows markdown.
- `test_smoke_skill_run.py` — `@pytest.mark.smoke`, skipped unless `RUNTIME_SMOKE=1`: real headless run of jd-evaluation@pinned with canned JD.

Existing `test_api.py` must stay green after the claude_exec extraction.

## 6. Doc updates (per feedback_doc_maintenance.md — only affected passages)

CLAUDE.md (skills section, `/skill` in commands table), workflow.md (pointer), README.md + DEVELOPER-README.md (new architecture/layout/runtime/endpoints), USER-GUIDE.md (`/skill`, updated `/interview`), QUICK-START.md (one paragraph), memory/MEMORY.md (migrated entries → skill pointers), webapp/README.md (endpoints + `RUNTIME_ADAPTER`/`RUNTIME_ALLOW_DRAFT`).

## 7. Commit sequence (each leaves repo working; DEV_MODE=true throughout, single manual commits)

1. **Scaffold + content** — skills/policies/workflows v1.md (verbatim copies), manifests, registry, README. No behavior change.
2. **Runtime core** — runtime/ package + claude_exec extraction from main.py + all unit tests. test_api.py green.
3. **Endpoints + packaging** — /api/skills* routes, FakeAdapter tests, Dockerfile COPY, k8s manifest check.
4. **Interactive cutover** (the risky one, single revertable commit) — /skill command, CLAUDE.md rewrite, workflow.md pointer, memory stubs, MEMORY.md, interview.md thinned, ingest references.
5. **Docs** per §6.
6. **Hermes spike** — verify headless CLI invocation against hermes-agent.org docs; implement hermes_adapter.py + fake-binary test; `status: experimental`.
7. *(Optional)* smoke test + promotion helper script.

Rollback: commits 1–3 change nothing user-facing; commit 4 is one revert.

## 8. Phase 3/4 seams (designed-in, not built)

- **Temporal (P3):** activities wrap `adapter.run_skill(...)` directly (runtime is FastAPI-free, pydantic-serializable) from a worker in the same image, or call `POST /api/skills/{name}/run`. `workflows/*/skill.yaml` later gains `steps:` mapping 1:1 to Temporal workflow steps; `inputs/outputs` become typed payloads. Temporal self-hosted on the openbrain k8s cluster, Python SDK.
- **Learning loop (P4):** `events.py` is the single chokepoint; `run_id` joins runs↔corrections↔promotions; immutable vN.md + changelog give regression tests their before/after pairs; events backend swaps to a `js_audit_events` table in job-search-schema.sql.

## Risks

- **md-hygiene**: covers all staged .md automatically; keep `$APP_DIR`/`$APPLICANT_DIR` variables in migrated content; never write "three sources" in CLAUDE.md (sentinel #6); keep workflow.md described correctly (sentinel #3/CLAUDE.md-tier wording).
- **Stop-hook commit splitting**: commit 4 touches memory/ and skills/ — commit manually in one commit before response ends.
- **Container drift**: skills must reach both webapp image and runner-pod seed — commit 3 checklist item.
- **Hermes headless unverified**: spiked last, never default, cannot block Claude path.
- **Dual source of truth (commits 1–3 window)**: v1 = verbatim copy; don't edit migrated memory files during the window; keep window short.

## Verification

1. `cd webapp/backend && .venv/bin/pytest tests/ -q` — full suite incl. new runtime tests green.
2. Registry validation test passes against the real repo tree (anti-drift).
3. `GET /api/skills` lists 10 entries; `POST /api/skills/jd-evaluation/run` with a canned JD task returns `status: ok` with a verdict (or run the RUNTIME_SMOKE=1 smoke test locally).
4. Interactive: new session → paste a JD → confirm the session reads `workflows/create-application` + `skills/jd-evaluation`; `/skill` round-trip works and pytest gate fires.
5. `/interview <company>` and `/ingest <profile>` dry-run still work post-cutover.
6. `bash scripts/check-md-hygiene.sh` clean on all new/modified markdown; pre-commit hook passes.
7. Docker: `docker build` webapp image; confirm `/app/skills` present in container.
