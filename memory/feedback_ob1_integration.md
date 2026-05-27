---
name: feedback_ob1_integration
description: OB1 integration rules — when OB1 is configured, all APPLICANT file reads and writes must go through OB1 MCP tools; direct GDrive/APPLICANT_DIR access is forbidden; MCP not connected = hard stop
metadata:
  type: feedback
---

When `OB1_MCP_URL` is set in `.env`, OB1 is configured and **all APPLICANT file operations must go through OB1 MCP tools** — both reads (`get_file`, `get_pipeline`, `get_overdue_followups`, etc.) and writes (`upload_file`, `update_application_status`, `upsert_company`, `add_contact`, etc.). Direct GDrive/`$APPLICANT_DIR` file access is forbidden when OB1 is configured.

**Why:** OB1 is the authoritative data store when configured. Bypassing it creates drift between OB1 state and local GDrive files, breaking pipeline tracking, semantic search, and vector indexing.

**How to apply:** At every file read or write that would normally touch `$APPLICANT_DIR` (applicant.md, profiles, applications, memory, tracker), substitute the corresponding OB1 MCP call instead. `$APP_DIR` files (tooling, memory, workflow docs) are still read locally — only the applicant data directory is in OB1.

## Session start check

At session start (during `/context` workflow), verify OB1 MCP tools appear in the session's deferred tool list before reading any applicant files. Presence of `mcp__job_search__*` or `mcp__open_brain__*` tools confirms OB1 is connected.

If OB1 is configured but tools are **NOT** in the deferred list → **hard stop**. Do not fall back to GDrive. Tell the user:

> "OB1 is configured but MCP tools are not connected in this session. Please restart Claude Code to reconnect, then re-run `/context`."

**Why hard stop (not silent fallback):** Silently reading from GDrive when OB1 is configured makes the session appear to work while writing stale data to a source that OB1 won't see, causing silent divergence.

## MCP tool mapping (APPLICANT_DIR → OB1)

| Operation | Local (fallback only) | OB1 (when configured) |
|---|---|---|
| Read applicant file | `Read($APPLICANT_DIR/<key>)` | `get_file('<key>')` |
| Write applicant file | `Write($APPLICANT_DIR/<key>)` | `upload_file('<key>', content)` |
| Read pipeline | Read `application-tracker.md` | `get_pipeline()` |
| Update application status | Edit tracker | `update_application_status()` |
| Get overdue follow-ups | Parse tracker | `get_overdue_followups()` |
| Company/contact tracking | Edit tracker notes | `upsert_company()`, `add_contact()` |
| Semantic search | grep | `search_applications_semantic(query)` |

## File key convention

Object store keys mirror former local paths relative to `$APPLICANT_DIR`. Example: `applications/2026-05-15-co-role/notes.md` in OB1 = `$APPLICANT_DIR/applications/2026-05-15-co-role/notes.md` on disk.
