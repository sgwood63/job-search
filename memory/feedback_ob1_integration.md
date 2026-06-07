---
name: feedback_ob1_integration
description: OB1 integration rules — when OB1 is configured, all APPLICANT file reads and writes must go through OB1 MCP tools; direct GDrive/APPLICANT_DIR access is forbidden; MCP not connected = hard stop
metadata:
  type: feedback
---

## CANONICAL ROUTING RULE

This is the single source of truth for DATA_BACKEND routing. Command files and workflow docs reference this file — they do NOT restate the rule. Changes to OB1 routing must be made here only.

**Summary:** When `DATA_BACKEND=ob1` — use OB1 MCP tools for all APPLICANT operations. When `DATA_BACKEND=local` — use direct filesystem. If OB1 is configured but MCP tools are absent → hard stop, no fallback.

---

When `DATA_BACKEND=ob1` in `.env`, OB1 is configured and **all APPLICANT file operations must go through OB1 MCP tools** — both reads (`get_file`, `get_pipeline`, `get_overdue_followups`, etc.) and writes (`upload_file`, `update_application_status`, `upsert_company`, `add_contact`, etc.). Direct GDrive/`$APPLICANT_DIR` file access is forbidden when OB1 is configured.

**Why:** OB1 is the authoritative data store when configured. Bypassing it creates drift between OB1 state and local GDrive files, breaking pipeline tracking, semantic search, and vector indexing.

**How to apply:** At every file read or write that would normally touch `$APPLICANT_DIR` (applicant.md, profiles, applications, memory, tracker), substitute the corresponding OB1 MCP call instead. `$APP_DIR` files (tooling, memory, workflow docs) are still read locally — only the applicant data directory is in OB1.

## Two MCP servers, two roles

Two MCP servers are registered when OB1 is configured. They have distinct, non-overlapping responsibilities:

- **`mcp__job_search__*`** — owns ALL file I/O for APPLICANT content. `upload_file`, `get_file`, `list_files`, `delete_file`, and `get_file_url` are general-purpose and apply to every key under `$APPLICANT_DIR`: applicant.md, profiles, memory files, applications, search results — all of it. The name `job-search` is the server namespace, not a scope restriction to job application folders.

- **`mcp__open_brain__*`** — owns thought querying and capture: `search_thoughts`, `list_thoughts`, `thought_stats`, `capture_thought`, `fetch`, `search`. It does NOT own file reads or writes. Do not use it as a substitute for `upload_file` or `get_file`.

If in doubt about which server to call: file operations → `mcp__job_search__*`, thought/search operations → `mcp__open_brain__*`.

## Session start check

At session start (during `/context` workflow), verify **both** MCP servers are connected. Presence of `mcp__open_brain__*` alone is insufficient — `upload_file`, `get_file`, `get_pipeline`, and all file/pipeline operations live in the job-search server.

If `mcp__job_search__*` tools are absent at session start → **hard stop**. Tell the user:

> "OB1 is configured but job-search MCP tools are not connected. File reads, file writes, and pipeline operations are unavailable. Please restart Claude Code, then re-run `/context`."

No fallback, no curl workaround. If the tools are missing, we don't have a system.

**Why hard stop (not silent fallback):** A past incident (2026-05-27) showed that when the job-search MCP session handshake fails, the session proceeded without the tools and fell back to writing files directly to GDrive and MinIO — both forbidden. GDrive writes create silent drift. Direct MinIO writes bypass `js_files`, making files invisible in the webapp.

## MCP tool mapping (APPLICANT_DIR → OB1)

| Operation | Local (fallback only) | OB1 (when configured) | When |
|---|---|---|---|
| Read applicant file | `Read($APPLICANT_DIR/<key>)` | `get_file('<key>')` | On demand |
| Write applicant file | `Write($APPLICANT_DIR/<key>)` | `upload_file('<key>', content)` | On write |
| Read pipeline | Read `application-tracker.md` | `get_pipeline()` | `/status` or pipeline commands only — **not at session start** |
| Update application status | Edit tracker | `update_application_status()` | On status change |
| Get overdue follow-ups | Parse tracker | `get_overdue_followups()` | `/status` only — **not at session start** |
| Company/contact tracking | Edit tracker notes | `upsert_company()`, `add_contact()` | On JD processing |
| Semantic search | grep | `search_applications_semantic(query)` | On demand |

**Session start loads only:** `applicant.md` + `memory/APPLICANT-MEMORY.md` (in parallel). Pipeline and overdue follow-ups are deferred to `/status` and application workflow commands.

**Scope override:** If you find yourself reasoning that `get_file` or `upload_file` are "not appropriate" for a particular operation — a profile update, a memory file write, reading applicant.md — that reasoning is wrong. These tools cover the entire `$APPLICANT_DIR` key space. Discard the alternative approach and use the MCP tool.

## File key convention

Object store keys mirror former local paths relative to `$APPLICANT_DIR`. Example: `applications/2026-05-15-co-role/notes.md` in OB1 = `$APPLICANT_DIR/applications/2026-05-15-co-role/notes.md` on disk.

## Binary file uploads (PDFs)

`upload_file` accepts binary content as base64 with `binary: true`:

```
upload_file(key, base64_content, content_type='application/pdf', binary=True)
```

A 75KB PDF encodes to ~102KB base64 — well within MCP limits. There is no file size reason to bypass this tool for typical resumes.

If `upload_file` fails or times out: **hard stop**. Do NOT fall back to GDrive or direct MinIO. Report the failure to the user and let them decide how to recover.

**The MCP server is the transaction boundary.** `upload_file` does three things atomically in one server-side operation: writes to MinIO, inserts a `js_files` record, and captures a semantic thought (generates an embedding → writes to OB1 `thoughts` table → stores `thought_id` in `js_files`). Bypassing this tool by writing to MinIO directly makes Claude responsible for coordinating two systems it has no business managing — the same anti-pattern as an API consumer writing directly to a service's database. This is not correct MCP architecture; the server owns the transaction, the AI client calls tools.

**Consequence of bypass:** `thought_id = NULL` in `js_files` — the file exists in storage but is permanently invisible to semantic search (`search_applications_semantic`, `search_thoughts`). There is no repair path short of re-uploading through the MCP tool.

The two permanently forbidden fallbacks, regardless of the reason:
- Writing to `$APPLICANT_DIR` (GDrive) — creates silent drift with OB1 as authoritative store
- Writing to MinIO directly (mc, boto3, curl to MinIO port) — bypasses `js_files` and thought capture; file is invisible to semantic search

**Large file exception:** There is none. `upload_file` via base64 handles all file sizes in this system (resume PDFs ≤ 150KB, markdown files ≤ 100KB). If a future use case genuinely exceeds MCP transport limits, the correct solution is a pre-signed URL endpoint on the server — not direct MinIO access from Claude.

## PDF generation workflow in OB1 mode

PDF generation (pandoc + Playwright/Chromium) works in **all three contexts** — CLI, webapp subprocess, and K8s claude-runner sidecar. Both container images install Playwright + Chromium (`RUN playwright install --with-deps chromium`). `$PLAYWRIGHT_PYTHON` resolves correctly in each context:
- Mac (CLI/webapp): set to Anaconda path in `.env`
- K8s (webapp container + claude-runner sidecar): `python3` — set in `webapp-configmap.yml`

`curl http://127.0.0.1:8000/api/upload` also works in all three contexts:
- Mac CLI/webapp subprocess: hits local uvicorn on port 8000
- K8s claude-runner sidecar: hits the webapp container at port 8000 — both containers are in the same pod and share the network namespace

**Generate to `/tmp`, not to `$APPLICANT_DIR`.** After generation, upload to OB1 via the webapp endpoint.

**Correct sequence (works in all three contexts):**
```bash
# $APP_DIR, $PLAYWRIGHT_PYTHON are context-specific but always set correctly
TMP_HTML="/tmp/resume.html"
TMP_PDF="/tmp/resume.pdf"
FOLDER="applications/<folder>"

# 1. .md must come from OB1 (get_file) — write content to $TMP_MD before this
pandoc "$TMP_MD" -o "$TMP_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$TMP_HTML" "$TMP_PDF"
rm "$TMP_HTML"
pdfinfo "$TMP_PDF" | grep Pages

# 2. Upload to OB1 via webapp (writes both MinIO + js_files)
curl -s -X POST "http://127.0.0.1:8000/api/upload?dir=$FOLDER" -F "file=@$TMP_PDF"
rm "$TMP_PDF"
```

## When webapp shows stale content

Before touching local APPLICANT_DIR files, check what is stale:
1. Is it the .md or the PDF the user is viewing? (Different OB1 keys)
2. Verify OB1 state with `list_files` — sizes and timestamps tell you what's current
3. Never read local APPLICANT_DIR to "check" — trust the MCP tool return values

If .md uploaded successfully (MCP returned size) but webapp shows old PDF: the PDF was not uploaded to OB1. Upload it via `curl http://127.0.0.1:8000/api/upload` — do NOT write files to local APPLICANT_DIR as a workaround.
