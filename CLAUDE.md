# Claude Code — Job Search 2026

This file is auto-loaded at session start. It contains core context and workflow triggers. Detailed steps live in `workflow.md` (JD processing, resume pipeline) and `applicant-setup.md` (onboarding phases).

## Directory Paths

Canonical paths are defined in `$APP_DIR/.env` (gitignored). Read that file at session start to resolve path variables. If `.env` is not present, ask the user to run `bash scripts/setup.sh`.

| Variable | Defined in `.env` | Notes |
|---|---|---|
| `$APP_DIR` | Yes | Process repo, git-tracked |
| `$APPLICANT_DIR` | Yes | Applicant data, NOT git-tracked |

Applicant-specific context (identity, location, experience, job criteria) is in `$APPLICANT_DIR/applicant.md`.

## APP_DIR File Authoring Rules

Every `.md` file in `$APP_DIR` must use "the applicant" or "the user" (never the applicant's name) and must never contain hard-coded absolute paths. A pre-commit hook (`scripts/check-md-hygiene.sh`) enforces both rules at commit time.

## New Applicant Setup — DO NOT ASK, JUST DO

When the user says "start setup", "set up applicant", or expresses clear intent to begin onboarding:

1. Verify `.env` is loaded and `$APPLICANT_DIR` exists — if not, tell user to run `bash scripts/setup.sh`
2. Read `$APP_DIR/applicant-setup.md` and execute phases A–E in order, pausing between each for confirmation
3. Use **Sonnet** throughout — setup is generative work, not screening

## Automated Workflow — DO NOT ASK, JUST DO

When the user provides a job description (URL, document, or paste), execute immediately. See `workflow.md` for full detail.

**Fetch:** Try WebFetch first. On login wall or failure, fall back to `"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" "<url>"`. Exit code 2 = auth required — show user the stderr setup command; exit code 1 = ask user to paste.

**Screen (Haiku):** Spawn a Haiku agent to extract company/role/location/travel/comp, check fit against `$APPLICANT_DIR/applicant.md`, and match to best profile using `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`.

**Folder (every JD, fit or no-fit):** `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/` with `job-description.md` and original JD file (`jd-<company>-<role>.[ext]`).

**No fit:** Brief `notes.md`, tracker update (Rejected section), stop.

**Fit:** Switch to Sonnet. Read matched profile files. Generate resume, create detailed `notes.md`, update tracker (Active section).

## Profile Maintenance — DO NOT ASK, JUST DO

When the user provides new experience, achievements, preference changes, or career direction updates, execute immediately. See `applicant-setup.md` Phase F for the full classification matrix, file rules, and logging instructions.

**Key rules:**
- For adding a new achievement or creating a new profile: run the explicit checklists in `memory/feedback_profile_maintenance.md` — do not substitute registry reasoning for these two operations
- For all other maintenance: consult the File Registry in `applicant-setup.md` Phase F — reason from what changed against each file's role to determine what needs updating
- Append a session entry to `$APPLICANT_DIR/applicant-maintenance.md`
- Update `career-advice.md` Feedback Incorporated only when the change directly affects the advice; when a new profile is created, always update career-advice.md §1 (Profile Fit Scores) and §5 (Compensation Expectations)
- Do not update `APPLICANT-MEMORY.md` for maintenance changes

## Documentation Maintenance — DO NOT ASK, JUST DO

After editing any `$APP_DIR` source file (CLAUDE.md, workflow.md, applicant-setup.md, .claude/commands/*.md, scripts/*.sh, scripts/*.py, .claude/settings.json, templates/), check whether QUICK-START.md, README.md, USER-GUIDE.md, DEVELOPER-README.md, or scripts/README.md references the changed area, and update only the affected passages.

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

**No fabrication.** Source only from `$APPLICANT_DIR/profiles/[profile]-CONTENT.md` and `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`. Never invent companies, titles, achievements, metrics, projects, skills, or certifications. If uncertain, ask.

**No unverified percentage metrics.** Verified, sourced percentages are allowed. Unverified/estimated X% claims must use qualitative language instead ("substantially improved", "significantly reduced"). Counts and named outputs are always fine (50+ engagements, 400+ customers).

**Domain connection.** For every application: identify the target company's business domain and surface the applicant's connections in `notes.md` (Fit Assessment → Domain Connection subsection) and in resume bullets. Check all four sources: (1) professional roles; (2) personal/life experience (cover letter only, not bullets); (3) specific artifacts built — demos, reference implementations, POCs in the domain; (4) use-case connections — adjacent industry or process exposure that maps to what the company's product does. See `memory/feedback_domain_connection.md`.

**Review before PDF.** Write `.md` → assess vs. JD → edit → generate PDF → verify page count. Never skip. See `workflow.md` for PDF command.

## Resume Generation

**Length:** 2 pages for enterprise/consulting/governance roles; 1 page for networking, warm referrals, recruiter outreach, pre-sales SE, pivots.

**After generating:** Produce a detailed evaluation report scoring each JD requirement vs. resume coverage, flagging gaps and competitive positioning.

See `workflow.md` for: notes.md structure, PDF command, file naming, section labels, earlier career rules, evaluation report format.
See `memory/` feedback files (indexed in MEMORY.md) for: bullet formula, role ordering, education/certs, signal density, no-duplication rules.

## Profiles Directory

`$APPLICANT_DIR/profiles/` is the working source of truth. `base-documents/` is setup-only — do not read it during normal workflow. See `templates/PROFILES-README.md` for authoring guidance.

## File Storage

`$APPLICANT_DIR` is set during setup to a local directory or a cloud sync service's managed local folder. The OS syncs automatically — no separate step needed.

## Workflow Rules

**Company lookup:** Check `$APPLICANT_DIR/application-tracker.md` before acting on any company mention. Multiple entries → confirm which is relevant (include "new position" as an option). See `memory/feedback_company_lookup.md`.

**Unknown company:** For unnamed JDs (recruiter postings, confidential), research the end company before generating documents. See `memory/feedback_unknown_company_research.md`.

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
| `/memory [update\|add\|read]` | Navigate and sync the memory system |

## Session Strategy

Short, task-scoped sessions (one application, one interview prep, one memory update). Long sessions degrade through context compression.

**Session start — DO NOT ASK, JUST DO:**

At the start of every session, automatically run the `/context` workflow before responding to any user request:
1. Read `$APP_DIR/.env` — resolve `$APP_DIR`, `$APPLICANT_DIR`, and `DEV_MODE`
2. Read `$APPLICANT_DIR/applicant.md`
3. Read `$APPLICANT_DIR/application-tracker.md` — flag past-due follow-ups, active interviews, Priority ⭐️⭐️⭐️ items
4. Read `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md`
5. Read `$APP_DIR/memory/MEMORY.md`
6. Output a session briefing (10 lines max): active pipeline count, past-due follow-ups, most urgent next action, confirm `$APPLICANT_DIR` resolved, state DEV_MODE status (e.g. "DEV_MODE=false — APP_DIR is read-only"). End with: "Context loaded. Ready."

Exception: skip if the user's first message makes clear context is already loaded (e.g., "continuing from before", mid-task handoff).

**Applicant memory — DO NOT ASK, JUST DO:**

When the user states a clear new preference, fact, constraint, or rule about themselves (location, compensation, role criteria, deal-breakers, work style, etc.), immediately update the relevant file in `$APPLICANT_DIR/memory/`. No sync step needed — `$APPLICANT_DIR` is a plain local directory.

**Session end — do without being asked:**
1. Update `$APPLICANT_DIR/memory/applicant-setup-status.md` with current search state
2. Ensure `$APP_DIR/.claude/settings.json` statusLine reflects current phase

Note: `$APP_DIR/memory/` sync (git commit + copy to `~/.claude/`) is now handled automatically by a Stop hook after every response — no manual step needed.

## Cost Optimization

- **Haiku** for JD screening (12× cheaper than Sonnet)
- **Sonnet** for document generation only
- Reuse resume content within a session; do not re-extract from PDFs

## Memory Sync Rule

`$APP_DIR/memory/` is the source of truth. After every response, `scripts/sync-memory.sh` runs automatically via a Stop hook: it commits any uncommitted changes in `memory/` and copies them to `~/.claude/projects/.../memory/`. No manual step needed.

To sync manually (e.g., after editing outside a session):

```bash
bash "$APP_DIR/scripts/sync-memory.sh"
```

Applicant-specific memory lives in `$APPLICANT_DIR/memory/` and is updated in real-time during sessions — no sync step needed.
