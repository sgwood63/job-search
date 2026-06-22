---
name: Documentation maintenance after source-file edits
description: After editing any $APP_DIR source file, scan the human-facing docs for references to the changed area and update only the affected passages
type: feedback
---

When Claude edits any source file in $APP_DIR, check whether any human-facing doc references the changed area and update only the affected passage(s). Do not rewrite the whole document.

**Why:** Human-facing docs silently drift when source files change, causing confusion for new applicants and during setup.

**How to apply:** After every source-file edit, use the lookup table below to identify which docs to scan, find the specific passages that reference the changed item, and update only those.

---

## Documentation Inventory

All registered human-facing docs. Use this to quickly identify which docs exist before deciding where to make an update.

| Doc | Audience | Purpose |
|-----|----------|---------|
| `README.md` | First-time reader / overview | High-level system overview, requirements, two-repo structure, links to other docs |
| `QUICK-START.md` | New user setting up for the first time | Step-by-step bootstrap (setup script + applicant setup) |
| `USER-GUIDE.md` | End user — non-technical | Day-to-day workflow: commands, web app views, interview prep, profile updates |
| `DEVELOPER-README.md` | Developer / maintainer | Architecture, hooks, scripts, settings, DEV_MODE, slash command internals |
| `DEPLOYMENT.md` | Developer / operator | All deployment options (local, Docker Compose, K8s, OB1 default), decision guide, env config |
| `scripts/README.md` | Developer / maintainer | Per-script command reference, flags, exit codes, direct-invocation notes |
| `scripts/README-linkedin-extractors.md` | Developer / user | LinkedIn URL extraction tools, browser console script, workflow |
| `webapp/README.md` | Developer | Webapp launch options, configuration, API reference, testing |
| `integrations/ob1/README.md` | Developer / operator | K8s deployment steps, Docker Compose alternative, env vars, migration |
| `templates/PROFILES-README.md` | Applicant / setup | Profile directory structure, file roles, authoring rules, resume format |

---

## Trigger — source files that drive doc updates

Apply this rule after editing any of the following:

- `$APP_DIR/CLAUDE.md`
- `$APP_DIR/workflow.md`
- `$APP_DIR/applicant-setup.md`
- `$APP_DIR/.claude/commands/*.md`
- `$APP_DIR/skills/`, `$APP_DIR/policies/`, `$APP_DIR/workflows/` (adding or renaming an entry)
- `$APP_DIR/scripts/*.sh` or `$APP_DIR/scripts/*.py`
- `$APP_DIR/.claude/settings.json`
- `$APP_DIR/templates/` (any file)
- `$APP_DIR/memory/MEMORY.md` (structural changes only — new sections, removed entries)
- `$APP_DIR/docs/` (adding or removing a subdirectory — content edits within existing files do not trigger)
- `$APP_DIR/integrations/ob1/k8s/*.yml`, `docker-compose.yml`, `Dockerfile` (K8s/compose config changes)
- `$APP_DIR/webapp/backend/main.py` (new API endpoint), `$APP_DIR/webapp/start.sh` (launch changes)

Do NOT trigger on edits to the doc files themselves (README.md, USER-GUIDE.md, QUICK-START.md, DEVELOPER-README.md, DEPLOYMENT.md, scripts/README.md, scripts/README-linkedin-extractors.md, webapp/README.md, integrations/ob1/README.md, templates/PROFILES-README.md) or to `$APPLICANT_DIR` files.

## Lookup table — source file → which docs to check

| Source changed | Docs to scan |
|---|---|
| CLAUDE.md (workflow rules, trigger phrases, session rules) | README.md, QUICK-START.md |
| CLAUDE.md (Available Commands table) | USER-GUIDE.md |
| workflow.md | README.md (What This System Does section), QUICK-START.md (Phase 2) |
| applicant-setup.md (phases A–E) | QUICK-START.md (Phase 1 Step 2), USER-GUIDE.md (Getting Set Up section) |
| applicant-setup.md (Phase F) | USER-GUIDE.md (Updating Your Profile section) |
| scripts/setup.sh | QUICK-START.md (Phase 1 Step 1), README.md (Requirements table), scripts/README.md |
| scripts/fetch-jd.py | DEVELOPER-README.md (JD Fetching), scripts/README.md, QUICK-START.md |
| scripts/generate-pdf.py | DEVELOPER-README.md (PDF Generation), scripts/README.md |
| scripts/check-md-hygiene.sh | DEVELOPER-README.md (Markdown Hygiene), scripts/README.md |
| scripts/install-hooks.sh | scripts/README.md |
| scripts/sync-memory.sh | DEVELOPER-README.md (Memory System, Customizing Workflow Rules) |
| .claude/settings.json (statusLine or hooks) | DEVELOPER-README.md (Settings Reference, Hook System), README.md, QUICK-START.md — only if the change affects user-visible workflow |
| .claude/commands/*.md (new, renamed, or changed command) | USER-GUIDE.md (Command Quick Reference), DEVELOPER-README.md (Slash Command Architecture), CLAUDE.md (Available Commands table) |
| templates/ (CSS files) | DEVELOPER-README.md (PDF Generation) |
| templates/scaffold/ (stub files) | DEVELOPER-README.md (Applicant Repo file tree) |
| memory/MEMORY.md (new or removed index entry) | No human-facing doc references memory file names — no doc update needed |
| workflows/ (new or renamed workflow) | DEVELOPER-README.md (file tree — `workflows/` comment listing names) |
| docs/ (new or renamed subdirectory) | DEVELOPER-README.md (file tree — `docs/` entry listing subdirs) |
| skills/ or policies/ (new or renamed entry) | DEVELOPER-README.md only if the entry name is explicitly listed in the tree comment (currently none are — the generic `<name>/` pattern covers all) |
| DEVELOPER-README.md (structural changes) | README.md (Getting Started section), CLAUDE.md (Available Commands section) |
| integrations/ob1/k8s/*.yml or docker-compose.yml (K8s/compose service changes) | integrations/ob1/README.md (Setup Order, Docker Compose Alternative, Environment Variables) |
| integrations/ob1/Dockerfile (image build changes) | integrations/ob1/README.md (step 8: Build and deploy job-search-mcp) |
| webapp/backend/main.py (new or removed API endpoint) | webapp/README.md (API Endpoints section) |
| webapp/start.sh (launch changes, version requirements) | webapp/README.md (Launch sections), DEPLOYMENT.md (Config 1, Config 2) |
| DEPLOYMENT.md (new config or new dimension) | README.md (What This System Does — if it changes the high-level capability description) |

---

## Document character — audience and content rules

When updating a doc, match the register of the surrounding content. Each doc has a defined audience and hard rules about what belongs.

| Doc | Audience | Include | Never include | Notes |
|-----|----------|---------|---------------|-------|
| `USER-GUIDE.md` | End user — non-technical | What a feature does for the user, when to use it, how to invoke it, plain-English examples with fictitious names | File paths, internal file names (notes.md, tracker, memory/), "session"/"sync"/"memory" jargon, implementation mechanics, what files are updated | Has `## Contents` TOC — update when headings change |
| `DEVELOPER-README.md` | Developer / maintainer | Architecture, file trees, DEV_MODE operation, hooks, scripts, settings, command file locations, full technical detail | End-user workflow narrative — link to USER-GUIDE instead | Has `## Contents` TOC — update when headings change |
| `README.md` | First-time reader / overview | High-level pipeline, requirements, two-repo structure (brief), links to the other docs | Deep technical detail (belongs in DEVELOPER-README), step-by-step how-to (belongs in QUICK-START or USER-GUIDE) | Has `## Contents` TOC — update when headings change |
| `QUICK-START.md` | New user setting up for the first time | Step-by-step bootstrap instructions, setup commands, what each phase produces | Internal architecture detail (belongs in DEVELOPER-README), day-to-day workflow detail (belongs in USER-GUIDE) | Has `## Contents` TOC — update when headings change |
| `scripts/README.md` | Developer / maintainer | Per-script command reference, flags, exit codes, exact shell invocations | End-user narrative — scripts are called automatically; this doc is for direct invocation and troubleshooting | Has `## Contents` TOC — update when headings change |
| `scripts/README-linkedin-extractors.md` | Developer / user | Browser console tool usage, workflow, troubleshooting | Architecture or OB1 detail | Has `## Contents` TOC — update when headings change; emoji headings permitted |
| `DEPLOYMENT.md` | Developer / operator | All deployment dimensions, env vars, tested configurations with full step-by-step, observability setup | Day-to-day usage (→ USER-GUIDE), system internals (→ DEVELOPER-README) | Has `## Contents` TOC — update when headings change |
| `webapp/README.md` | Developer | Launch options, configuration vars, API reference, test commands | End-user workflow (→ USER-GUIDE), deployment plumbing (→ DEPLOYMENT.md) | Has `## Contents` TOC — update when headings change |
| `integrations/ob1/README.md` | Developer / operator | K8s setup steps, port-forward commands, env vars, schema migration, Docker Compose alternative | Conceptual deployment overview (→ DEPLOYMENT.md) | Has `## Contents` TOC — update when headings change |
| `templates/PROFILES-README.md` | Applicant / setup | Profile directory structure, file roles, authoring rules, resume format | Resume generation mechanics (→ skills/resume-generation) | Has `## Contents` TOC — update when headings change |

**Rule:** If a change to a source file requires adding new information to USER-GUIDE.md, describe the user-visible effect only — not the mechanism. If the same change also touches DEVELOPER-README.md, that entry can include the full technical detail.

---

## TOC Maintenance

Every human-facing doc has a `## Contents` section. It must be updated whenever a heading in that file is added, removed, or renamed.

**Trigger:** Any edit to a registered doc file that adds, removes, or renames a heading.

**Rule:** After the heading change, update the `## Contents` block at the top of the same file:
- Added heading → add the corresponding entry in the correct position
- Removed heading → remove its entry
- Renamed heading → update the link text and anchor to match

**Anchor format (GFM):** lowercase; spaces → hyphens; strip colons, parentheses, em dashes (`—`), apostrophes, tildes, backticks, slashes, ampersands (`&`), dots; keep underscores and hyphens; do not collapse multiple adjacent hyphens.

Do NOT update the TOC for edits that don't change headings (adding prose, updating code blocks, fixing a table row, etc.).

---

## Documentation Hygiene Standards

**TOC requirement:** A `## Contents` section is required for any human-facing doc with 3 or more `##`-level sections. All 10 registered docs currently meet this standard. Internal procedural files (skills/*, policies/*, workflows/*, memory/*) are exempt.

**TOC depth:** Include `##` headings always. Include `###` headings only when they are primary navigation targets: numbered setup steps (integrations/ob1/README.md), named deployment configs (DEPLOYMENT.md), or per-script entries (scripts/README.md). Do not include `####` or deeper.

**Scope statement:** Every doc has (or should have) a 1–2 sentence scope paragraph immediately after the H1 title, before the `## Contents` block — describing what the doc covers and pointing to related docs for out-of-scope topics.

**Cross-reference rule:** When a doc is related to another, link explicitly (e.g., "For day-to-day usage, see [USER-GUIDE.md](USER-GUIDE.md)"). DEPLOYMENT.md, integrations/ob1/README.md, and webapp/README.md already do this well.

**Emoji rule:** Do not use emoji in headings of technical reference docs. `scripts/README-linkedin-extractors.md` is a special-purpose guide and may keep them; all other docs should not have emoji headings.

---

## How to apply

1. After writing the source-file edit, identify which row(s) of the lookup table apply.
2. Read the listed doc file(s).
3. Find every paragraph, table row, code block, or section heading that references:
   - the changed file by name, OR
   - the feature/command/flag/behavior that changed
4. Update only those passages to match the new state. Preserve all surrounding content.
5. If the change introduced a genuinely new item (new command, new script, new flag) with no prior mention in the doc, add a minimal entry following the surrounding format.
6. If the change removed an item, delete its entry in the doc.

## What NOT to do

- Do not rewrite paragraphs that remain accurate.
- Do not restructure the document or add new explanatory sections.
- Do not update docs for edits to `$APPLICANT_DIR` files.
- Do not trigger on your own doc-file edits (prevents cascade loops).
