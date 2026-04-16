---
name: Job Search App — Design and Status
description: Streamlit + Anthropic API app to replace free-form Claude Code chat with scoped sub-process sessions
type: project
originSessionId: 6d481a27-2bbf-40d8-a734-b1dc20abff39
---
A dedicated job search assistant app built at `Job-Search-2026/app/`.

**Status**: Complete (2026-04-15). app.py (Streamlit UI), engine.py (API + file engine), config.yaml, and 6 process YAMLs all built. Two-directory architecture: app source (git-tracked) + APPLICANT_DIR (untracked, at `/Users/shermanwood/Documents/Job-Search-Applicant/`).

**Why:** Single long Claude Code sessions degrade after context compression. Shorter, scoped sessions with the right context loaded per task solve this. The app replaces the chat workflow.

**Stack**: Streamlit (UI + file upload) + Anthropic Messages API + YAML process definitions.

**Two-directory architecture** (completed 2026-04-15):
- `Job-Search-2026/` — app source, git-tracked: process YAMLs, templates/, app-process memory/
- `$APPLICANT_DIR` (`/Users/shermanwood/Documents/Job-Search-Applicant/`) — applicant data, NOT git-tracked: profiles/, applications/, base-documents/, application-tracker.md, applicant.md, memory/

**6 processes defined**:
- `screen-jd` — Haiku; evaluate fit, create application folder
- `generate-resume` — Sonnet; tailored resume from profile CONTENT.md
- `review-resume` — Sonnet; critique against JD and EXPERIENCE-REFERENCE.md
- `interview-prep` — Sonnet; targeted prep notes per round type
- `debrief` — Haiku; post-interview capture and tracker update
- `update-memory` — Sonnet; memory file maintenance (routes memory/ vs applicant-memory/ writes)

**Path prefix convention**: `app:PATH` → resolved from `Job-Search-2026/`; `applicant:PATH` → resolved from `$APPLICANT_DIR`.

**Memory write routing**: `memory/FILENAME.md` → app-process (git-tracked); `applicant-memory/FILENAME.md` → `$APPLICANT_DIR/memory/` (not git).

**How to apply:** Reference this when user asks about the app, app status, APPLICANT_DIR, or memory routing.
