# Job Search 2026 - Process Memory

## Process Overview
Job application workflow using profile-based resume customization, Claude Code processes, and structured tracking.

## Key Files
- `README.md`, `QUICK-START.md`, `workflow.md` - Documentation
- `templates/` - CSS and reusable content library
- `scripts/` - Helper utilities
- See [reference_directories.md](reference_directories.md) — **canonical path definitions** (`$APP_DIR`, `$APPLICANT_DIR`)

## Applicant Context
Applicant-specific context (identity, location, experience, role rules) lives in the applicant directory — not here.
Index: `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md`

## Automated Workflow (DO NOT ASK, JUST DO)

When a JD is provided, execute the workflow `$APP_DIR/workflows/create-application/` (pinned version per its `skill.yaml`). It covers: fetch fallback chain → delegate to `workflows/process-jd/` (screen via `jd-evaluation` Haiku, create folder + JD files + initial notes, register in tracker) → no-fit stop → fit: expand notes to full structure + resume via `resume-generation` (Sonnet) + tracker update.

## Resume Generation Workflow
- See `$APP_DIR/skills/resume-generation/` (pinned version) plus the policies in its `skill.yaml` — two-phase flow, role ordering, Education/Certs, no unverified percentages, PDF via Playwright, file naming, signal density, evaluation report. Cover letters: `$APP_DIR/skills/cover-letter/`.

## Critical Rules: Document Generation
- `$APP_DIR/policies/factuality/` — never fabricate; no unverified percentage metrics
- `$APP_DIR/policies/evidence-grounding/` — source only from `[profile]-CONTENT.md` + `EXPERIENCE-REFERENCE.md`; content-library headers are not job titles; verify role order; if a source is unreadable, ask
- `$APP_DIR/policies/company-descriptors/` — domain connection (four sources) + company descriptions in role entries

## Session Start (DO WITHOUT BEING ASKED)
At the start of every session, automatically run the `/context` workflow once before responding to the first user request: read `.env`, then in parallel load `applicant.md` + `APPLICANT-MEMORY.md` (via OB1 MCP if configured, else direct reads). Output a briefing confirming identity, OB1/local mode, and DEV_MODE. End with "Context loaded. Ready." **Do not load pipeline or application-tracker.md at session start** — those are deferred to `/status`. Skip if the user's first message makes clear context is already loaded.

## Applicant Memory — Update in Real-Time (DO WITHOUT BEING ASKED)
When the user states a clear preference, fact, constraint, or rule about themselves, immediately update the relevant file in `$APPLICANT_DIR/memory/`. No sync step needed — `$APPLICANT_DIR` is plain local storage.

## Session End (DO WITHOUT BEING ASKED)
- See `feedback_session_end.md` — always update `$APPLICANT_DIR/memory/applicant-setup-status.md` before ending any session
- statusLine is now dynamic (`scripts/status-line.sh` reads the tracker live) — no manual update needed
- `$APP_DIR/memory/` sync is now automatic (Stop hook runs `scripts/sync-memory.sh` after every response) — no manual git step needed

## Profiles Directory — Source of Truth
- See [project_profiles_directory.md](project_profiles_directory.md) — `profiles/` contains EXPERIENCE-REFERENCE.md and role-achievements.md; `base-documents/` is setup-only

## Profile Maintenance (DO NOT ASK, JUST DO)
- See `applicant-setup.md` Phase F — trigger phrases, File Registry, Cross-Profile Propagation Rule, and logging instructions
- After every maintenance session: append entry to `$APPLICANT_DIR/applicant-maintenance.md`
- Update `career-advice.md` Feedback Incorporated only when the change directly affects the advice
- When target roles or JD signal keywords change: update the `## Search Queries` table row in `PROFILES-QUICK-REFERENCE.md`; include adjacent titles (names other companies use for the same function); aim for 8–14 terms per query; when a profile is removed, delete its row

## Job Ingestion (/ingest, /linkedin-ingest commands)
- `/ingest <profile>` → runs workflow `search-jobs` (Google Jobs via SearchAPI); `/linkedin-ingest` → runs workflow `search-jobs-linkedin` (LinkedIn recommendations)
- Both delegate per-job processing to workflow `process-jd` (canonical: screen via `jd-evaluation` Haiku, folder creation, JD files, notes stub, tracker registration)
- Fetch-failed stubs (when JD URL unreachable) are handled inline in each ingest workflow — not delegated to `process-jd`
- Saves fit jobs as application stubs — does NOT auto-generate resumes
- Per-run summary: `$APPLICANT_DIR/search/YYYY-MM-DD-HHMMSS-<profile>-summary.md`; log: `search-log.csv`
- Requires `SEARCHAPI_KEY` (`/ingest`) or `PLAYWRIGHT_PYTHON` (`/linkedin-ingest`) in `.env`

## OB1 Integration
- See `$APP_DIR/policies/storage-routing/` (pinned version) — when OB1 configured, ALL APPLICANT reads/writes must use OB1 MCP tools; MCP not connected = hard stop (not fallback); upload routing MCP vs REST

## Architecture Roadmap
- See [project_hermes_architecture_phases.md](project_hermes_architecture_phases.md) — phases 1+2 (versioned skills + runtime) landed on branch `hermes` 2026-06-12; phase 3 (Temporal self-hosted on openbrain k8s, Python SDK) and phase 4 (OB1 audit events + learning loop) decided but deferred

## Versioned Skills (source of truth for migrated rules)
Procedural rules below were migrated to `$APP_DIR/skills/`, `policies/`, `workflows/` (index: `skills/registry.yaml`; the old `feedback_*` files are pointer stubs). Interactive sessions prefer `draft.md` when present, else the pinned version. Changes go through `/skill draft` → `/skill promote`.
- Application tracking + status updates (two-file rule) → `workflows/create-application/`
- JD screening, folder creation, file composition, OB1/local routing, tracker registration → `workflows/process-jd/` (canonical shared module — used by create-application, search-jobs, search-jobs-linkedin)
- Unknown-company research → `skills/jd-evaluation/`
- Domain connection → `policies/company-descriptors/`
- JD file saving (verbatim `jd-*.md` + structured `job-description.md`) → `workflows/process-jd/`
- Google Jobs ingestion → `workflows/search-jobs/`; LinkedIn ingestion → `workflows/search-jobs-linkedin/`
- Resume generation → `skills/resume-generation/`; cover letters → `skills/cover-letter/`
- Interview prep → `skills/interview-prep/` + `workflows/prepare-interview/`
- OB1 routing → `policies/storage-routing/`

## Workflow Rules (not migrated — session/tooling mechanics)
- See `feedback_session_strategy.md` — use short, task-scoped sessions; long sessions degrade through context compression
- See `feedback_doc_maintenance.md` — after editing any $APP_DIR source file, use the lookup table to identify which human-facing docs reference the changed area and update only those passages
- See `feedback_profile_maintenance.md` — when adding a new achievement or creating a new profile, run the explicit 4-step or 6-step checklist; do not rely on registry reasoning alone for these two operations
- See `feedback_dev_mode.md` — never auto-toggle DEV_MODE; always prompt user to enable/disable manually and wait
- See `feedback_commits.md` — multi-file changes must be committed together; commit all APP_DIR files manually before response ends to prevent Stop hook splitting the commit
- See `feedback_model_selection.md` — when to use Opus vs Sonnet; no auto-routing in Claude Code; opusplan alias for planning sessions

## Memory Sync Rule
`$APP_DIR/memory/` is the source of truth. After every Claude response, `scripts/sync-memory.sh` runs automatically via a Stop hook: commits any uncommitted changes in `memory/` and copies them to `~/.claude/projects/.../memory/`. No manual step needed during sessions.

To sync manually (e.g., after editing outside a session):
```bash
bash "$APP_DIR/scripts/sync-memory.sh"
```
Applicant-specific memory lives in `$APPLICANT_DIR/memory/` and is updated in real-time during sessions — no sync step needed.

## Cost Optimization Notes
- Use Haiku for JD screening (12x cheaper than Sonnet)
- Use quick-reference profiles for initial matching
- Switch to Sonnet only for document generation
- Content is pre-compiled in `$APPLICANT_DIR/profiles/[profile]/[profile]-CONTENT.md` — no per-session extraction needed

**Last Updated**: 2026-06-12

---

*Note: Applicant-specific session state (setup completion, active profiles, unverified items) lives in `$APPLICANT_DIR/memory/`. Read `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md` at session start for current applicant context.*
