---
name: Job Search App — Design and Status
description: Streamlit + Anthropic API app to replace free-form Claude Code chat with scoped sub-process sessions
type: project
originSessionId: 6d481a27-2bbf-40d8-a734-b1dc20abff39
---
A dedicated job search assistant app is being built at `Job-Search-2026/app/`.

**Status**: Scaffolded (2026-04-15). CLAUDE.md, config.yaml, .env.example, requirements.txt, and 6 process YAMLs created. No app code yet.

**Why:** Single long Claude Code sessions degrade after context compression. Shorter, scoped sessions with the right context loaded per task solve this. The app replaces the chat workflow.

**Stack**: Streamlit (UI + file upload) + Anthropic Messages API + YAML process definitions.

**6 processes defined**:
- `screen-jd` — Haiku; evaluate fit, create application folder
- `generate-resume` — Sonnet; tailored resume from profile CONTENT.md
- `review-resume` — Sonnet; critique against JD and EXPERIENCE-REFERENCE.md
- `interview-prep` — Sonnet; targeted prep notes per round type
- `debrief` — Haiku; post-interview capture and tracker update
- `update-memory` — Sonnet; memory file maintenance

**Key design**: Each process YAML has a `guidance:` field. User feedback during sessions appends to it — this is how processes evolve without code changes.

**Next step**: Open a new Claude Code session in `app/` and build `app.py` and `engine.py`. CLAUDE.md provides full context for that session.

**How to apply:** Reference this when user asks about the app, app status, or next build steps.
