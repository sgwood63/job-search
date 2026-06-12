# Claude Code — Job Search 2026

This file is auto-loaded at session start. It contains core context and workflow triggers. Detailed procedures live in versioned skill documents under `skills/`, `policies/`, and `workflows/` (see "Skills Are the Source of Truth" below) and in `applicant-setup.md` (onboarding phases).

## Directory Paths

Canonical paths are defined in `$APP_DIR/.env` (gitignored). Read that file at session start to resolve path variables. If `.env` is not present, ask the user to run `bash scripts/setup.sh`.

| Variable | Defined in `.env` | Notes |
|---|---|---|
| `$APP_DIR` | Yes | Process repo, git-tracked |
| `$APPLICANT_DIR` | Yes | Applicant data, NOT git-tracked |

Applicant-specific context (identity, location, experience, job criteria) is in `$APPLICANT_DIR/applicant.md`.

## APP_DIR File Authoring Rules

Every `.md` file in `$APP_DIR` must use "the applicant" or "the user" (never the applicant's name) and must never contain hard-coded absolute paths. A pre-commit hook (`scripts/check-md-hygiene.sh`) enforces both rules at commit time.

## Skills Are the Source of Truth

Procedural knowledge lives in versioned documents under `$APP_DIR/skills/`, `$APP_DIR/policies/`, and `$APP_DIR/workflows/` — indexed by `skills/registry.yaml`, format spec in `skills/README.md`. Before executing a task covered by an entry, read the relevant version:

- **Interactive sessions:** use `draft.md` when present (announce "using DRAFT <name>"), otherwise the `pinned` version from the entry's `skill.yaml`
- **Policies listed in a skill's `skill.yaml` are mandatory companion reading** — read them alongside the skill
- Never edit a committed `vN.md`. Changes go through `/skill draft` → `/skill promote` (see the `/skill` command)
- When the user gives procedural feedback on a migrated area (resume rules, JD screening, interview prep, storage routing, domain connection), propose `/skill draft` on the relevant entry — do not edit the old `memory/feedback_*` pointer stubs

The webapp executes skills via `POST /api/skills/{name}/run` using pinned versions only.

## New Applicant Setup — DO NOT ASK, JUST DO

When the user says "start setup", "set up applicant", or expresses clear intent to begin onboarding:

1. Verify `.env` is loaded and `$APPLICANT_DIR` exists — if not, tell user to run `bash scripts/setup.sh`
2. Read `$APP_DIR/applicant-setup.md` and execute phases A–E in order, pausing between each for confirmation
3. Use **Sonnet** throughout — setup is generative work, not screening

## Automated Workflow — DO NOT ASK, JUST DO

When the user provides a job description (URL, document, or paste), execute the workflow `workflows/create-application` (pinned version) immediately. In brief: **Fetch** (fallback chain in the workflow) → **Delegate to `process-jd`** (screen via `jd-evaluation` Haiku agent, create folder + JD files + initial notes, register in tracker) → **No fit:** stop — `process-jd` closed it → **Fit:** switch to Sonnet, expand notes to full structure, generate resume via skill `resume-generation`, update tracker, present for review.

## Profile Maintenance — DO NOT ASK, JUST DO

When the user provides new experience, achievements, preference changes, or career direction updates, execute immediately. See `applicant-setup.md` Phase F for the full classification matrix, file rules, and logging instructions.

**Key rules:**
- For adding a new achievement or creating a new profile: run the explicit checklists in `memory/feedback_profile_maintenance.md` — do not substitute registry reasoning for these two operations
- For all other maintenance: consult the File Registry in `applicant-setup.md` Phase F — reason from what changed against each file's role to determine what needs updating
- Append a session entry to `$APPLICANT_DIR/applicant-maintenance.md`
- Update `career-advice.md` Feedback Incorporated only when the change directly affects the advice; when a new profile is created, always update career-advice.md §1 (Profile Fit Scores) and §5 (Compensation Expectations)
- Do not update `APPLICANT-MEMORY.md` for maintenance changes
- When a profile's target roles or JD signal keywords change, also update the `## Search Queries` table row for that profile in `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`. Queries use role/title terms only — no domain expertise appended. Include adjacent titles: names other companies use for the same function (e.g., "Solutions Architect" alongside "Solutions Engineer"). Aim for 8–14 terms per query for broad market coverage. When a profile is removed, delete its row from the Search Queries table.
- **DATA_BACKEND=ob1:** All `$APPLICANT_DIR` reads and writes route through OB1 MCP tools per the policy `policies/storage-routing` (pinned version) — including the MCP-vs-REST upload routing for binary/large files.

## Documentation Maintenance — DO NOT ASK, JUST DO

After editing any `$APP_DIR` source file (CLAUDE.md, workflow.md, applicant-setup.md, skills/, policies/, workflows/, .claude/commands/*.md, scripts/*.sh, scripts/*.py, .claude/settings.json, templates/), check whether QUICK-START.md, README.md, USER-GUIDE.md, DEVELOPER-README.md, or scripts/README.md references the changed area, and update only the affected passages.

**Key rules:**
- Use the lookup table in `memory/feedback_doc_maintenance.md` to identify which docs to check for each source file
- Update only the specific paragraphs, table rows, or code blocks that reference the changed item — never rewrite the whole document
- Do not trigger on edits to the doc files themselves (prevents infinite loops)
- Do not trigger on `$APPLICANT_DIR` file edits — those files are not referenced in the public docs

## Critical Rules

**APP_DIR is read-only by default (DEV_MODE).** A PreToolUse hook blocks Write and Edit calls to any file inside `$APP_DIR` when `DEV_MODE=false` (the default). To modify tooling, scripts, memory, or any other `$APP_DIR` file, set `DEV_MODE=true` in `.env` first — no restart required. Set it back to `false` when done. This is a hard technical block enforced by `scripts/check-dev-mode.sh`.

When the hook blocks a write, **always inform the user and pause** — they may not know their request triggered an APP_DIR edit. Tell them:
- Which file was blocked and what change was about to be made
- That DEV_MODE is off: `DEV_MODE=false` in `.env`
- How to resume: they should set `DEV_MODE=true` in `.env` manually, then reply "continue"

**Never set or unset DEV_MODE yourself.** The user must toggle it manually — this is an intentional safety boundary. Offer three paths: (a) enable DEV_MODE and reply "continue", (b) skip this step, (c) cancel. Wait for their choice.

When the user replies "continue" (or equivalent), **retry the blocked operation immediately** without re-explaining context. Once all APP_DIR edits for the task are done, remind the user to set `DEV_MODE=false` again.

**Communication level.** During multi-step workflows (JD processing, resume generation, profile maintenance), report at the impact level when a logical step completes — not at the file level. Do not narrate individual Write or Edit calls. Report: "JD screened — fit confirmed, folder created." or "Resume draft complete — 2-page, 7/9 JD requirements covered." Name a file only if a specific write fails.

**No fabrication.** The policy `policies/factuality` (pinned version) applies to every generated document: never invent companies, titles, achievements, metrics, projects, skills, or certifications; no unverified percentage metrics. Source only per `policies/evidence-grounding`. If uncertain, ask.

**Domain connection.** For every application: identify the target company's business domain and surface the applicant's connections per the policy `policies/company-descriptors` — check all four sources (professional roles; personal/life experience — cover letter only, not bullets; specific artifacts built; use-case connections) and capture in `notes.md` (Fit Assessment → Domain Connection subsection) and resume bullets.

**Review before PDF.** Write `.md` → assess vs. JD → edit → generate PDF → verify page count. Never skip. Full pipeline in skill `resume-generation`.

## Resume Generation

**Before generating any resume:** Read the skill `skills/resume-generation` (pinned version, or `draft.md` if present) plus the policies listed in its `skill.yaml`, and apply all rules — length, structure, signal density, verification gate, evaluation report, PDF command.

## Available Commands

Custom slash commands are in `$APP_DIR/.claude/commands/`. See [USER-GUIDE.md](USER-GUIDE.md) for usage and [DEVELOPER-README.md](DEVELOPER-README.md) for implementation details.

| Command | Purpose |
|---------|---------|
| `/setup [phase?]` | Run applicant onboarding (phases A–E); detects current state and resumes |
| `/context` | Load full session state at session start (applicant, pipeline, memory) |
| `/status` | Generate current pipeline snapshot with past-due follow-ups |
| `/audit [folder]` | Validate application folder completeness before submitting |
| `/apply "Co" "Role" "date" [url?]` | Record submission atomically in tracker + notes.md |
| `/interview [company] [stage]` | Load interview prep context for a specific application |
| `/skill [list\|show\|draft\|diff\|promote]` | Manage versioned skills/policies/workflows; draft → promote flow |
| `/memory [update\|add\|read]` | Navigate and sync the memory system |
| `/ingest [profile]` | Run workflow `search-jobs` (Google Jobs via SearchAPI); per-job processing via `process-jd`; saves fit jobs as stubs + summary |
| `/linkedin-ingest [--max-pages N]` | Run workflow `search-jobs-linkedin` (LinkedIn recommendations); per-job processing via `process-jd`; saves fit jobs as stubs + summary |

## OB1 Integration

**OB1 is configured when:** `DATA_BACKEND=ob1` in `.env`. When configured, all APPLICANT file operations must use OB1 MCP tools — direct `$APPLICANT_DIR` reads and writes are forbidden. For the canonical routing rule, MCP tool mapping table, and hard-stop protocol, see the policy `policies/storage-routing` (pinned version).

Port-forwards (nginx Ingress routes them; no port-forward needed when Ingress is up):
```bash
kubectl port-forward -n openbrain svc/openbrain 8000:8000 &
kubectl port-forward -n openbrain svc/job-search-mcp 8001:8001 &
```

MCP servers are registered in `.mcp.json` (gitignored). Copy `.mcp.json.example` and fill in your access keys if the file doesn't exist yet.

## Session Strategy

Short, task-scoped sessions (one application, one interview prep, one memory update). Long sessions degrade through context compression.

**Session start — DO NOT ASK, JUST DO:**

At the start of every session, automatically run the `/context` workflow once before responding to the first user request:
1. Read `$APP_DIR/.env` — resolve `$APP_DIR`, `$APPLICANT_DIR`, `DEV_MODE`, and whether OB1 is configured (`DATA_BACKEND=ob1`)
2. If OB1 is configured: verify `mcp__job_search__*` tools appear in the deferred tool list. If absent → **hard stop**: "OB1 is configured but job-search MCP tools are not connected. Please restart Claude Code, then re-run `/context`."
3. In parallel, load: `applicant.md` + `memory/APPLICANT-MEMORY.md` — via `get_file()` if OB1, else direct reads from `$APPLICANT_DIR`
4. Output a session briefing (10 lines max): applicant identity confirmed, OB1/local mode, `$APPLICANT_DIR` resolved, DEV_MODE status. End with: "Context loaded. Ready."

**Pipeline is not loaded at session start.** Run `/status` to see active applications, overdue follow-ups, and pipeline counts.

**DEV_MODE=false (default):** State: "DEV_MODE=false — APP_DIR is read-only." If a write to APP_DIR is attempted, the hook blocks it — follow the blocking protocol in Critical Rules.

**DEV_MODE=true (dev session):** State: "⚠️ DEV_MODE=true — APP_DIR is WRITABLE." Proceed with all APP_DIR writes without pausing or re-explaining the gate. After each logical set of changes, output one impact summary: what changed and what it fixes or enables. Remind the user to set `DEV_MODE=false` when the dev session is complete.

Exception: skip if the user's first message makes clear context is already loaded (e.g., "continuing from before", mid-task handoff).

**Applicant memory — DO NOT ASK, JUST DO:**

When the user states a clear new preference, fact, constraint, or rule about themselves (location, compensation, role criteria, deal-breakers, work style, etc.), immediately update the relevant file in `$APPLICANT_DIR/memory/`. No sync step needed — `$APPLICANT_DIR` is a plain local directory.

**Session end — do without being asked:**
1. `applicant-setup-status.md` is auto-generated by the Stop hook — no action needed.
2. The statusLine is dynamic (`scripts/status-line.sh` reads the tracker live) — no manual update needed unless the script itself is broken.
3. If something important was learned this session (new constraint, preference, company finding) and hasn't been recorded in `$APPLICANT_DIR/memory/` yet, write it now before ending.

Note: `$APP_DIR/memory/` sync and `applicant-setup-status.md` generation are both handled automatically by Stop hooks after every response — no manual steps needed.

