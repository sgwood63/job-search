---
name: Documentation maintenance after source-file edits
description: After editing any $APP_DIR source file, scan the human-facing docs for references to the changed area and update only the affected passages
type: feedback
---

When Claude edits any source file in $APP_DIR, check whether any human-facing doc references the changed area and update only the affected passage(s). Do not rewrite the whole document.

**Why:** Human-facing docs (QUICK-START, README, USER-GUIDE, scripts/README) silently drift when source files change, causing confusion for new applicants and during setup.

**How to apply:** After every source-file edit, use the lookup table below to identify which docs to scan, find the specific passages that reference the changed item, and update only those.

## Trigger — source files that drive doc updates

Apply this rule after editing any of the following:

- `$APP_DIR/CLAUDE.md`
- `$APP_DIR/workflow.md`
- `$APP_DIR/applicant-setup.md`
- `$APP_DIR/.claude/commands/*.md`
- `$APP_DIR/scripts/*.sh` or `$APP_DIR/scripts/*.py`
- `$APP_DIR/.claude/settings.json`
- `$APP_DIR/templates/` (any file)
- `$APP_DIR/memory/MEMORY.md` (structural changes only — new sections, removed entries)

Do NOT trigger on edits to the doc files themselves (QUICK-START.md, README.md, USER-GUIDE.md, scripts/README.md) or to `$APPLICANT_DIR` files.

## Lookup table — source file → which docs to check

| Source changed | Docs to scan |
|---|---|
| CLAUDE.md (workflow rules, trigger phrases, session rules) | README.md, QUICK-START.md |
| CLAUDE.md (Available Commands table) | USER-GUIDE.md |
| workflow.md | README.md (pipeline section), QUICK-START.md (Phase 2) |
| applicant-setup.md (phases A–E) | QUICK-START.md (Phase 1), USER-GUIDE.md (/setup command) |
| applicant-setup.md (Phase F) | QUICK-START.md ("When you learn something new" area) |
| .claude/commands/*.md (new, renamed, or changed command) | USER-GUIDE.md (Command Details section), CLAUDE.md (Available Commands table) |
| scripts/setup.sh | QUICK-START.md (Phase 1 Step 1), README.md (Process Repo section), scripts/README.md |
| scripts/fetch-jd.py | README.md (JD Fetching), scripts/README.md, QUICK-START.md |
| scripts/generate-pdf.py | README.md (PDF Generation), scripts/README.md |
| scripts/check-md-hygiene.sh | scripts/README.md, README.md |
| scripts/install-hooks.sh | scripts/README.md |
| scripts/sync-memory.sh | README.md (Memory section), QUICK-START.md (Memory section) |
| .claude/settings.json (statusLine or hooks) | README.md, QUICK-START.md — only if the change affects user-visible workflow |
| templates/ (CSS files) | README.md (PDF Generation section) |
| templates/scaffold/ (stub files) | README.md (Applicant Repo file tree) |
| memory/MEMORY.md (new or removed index entry) | CLAUDE.md (Workflow Rules pointer list) |

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
