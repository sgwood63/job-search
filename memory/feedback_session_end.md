---
name: Session end checklist — memory and status
description: At the end of every session, update applicant memory and ensure the status line is set up
type: feedback
---

At the end of every session, always do two things without being asked:

1. **Update applicant memory** — `$APPLICANT_DIR/memory/applicant-setup-status.md` should reflect the current state of the job search: completed phases, active profiles, hot opportunities, key findings, unverified items. This file is what future sessions use to orient quickly.

2. **Set up the status line** — `$APP_DIR/.claude/settings.json` should have a `statusLine` command that shows the current job search status. If it's already set and accurate, leave it. If the status has changed (new phase complete, applications submitted, etc.), update it to reflect the current state.

**Why:** The user explicitly asked for both of these to be done routinely. These are the two session-end hygiene tasks that carry context forward without relying on conversation history.

**How to apply:** Before ending any session (when wrapping up work or when the user signals the session is complete), check both of these and update them. Do not wait to be asked.

**StatusLine format:**
```
"Job Search 2026 | [N] active | [Status hint] | [next action]"
```
Examples:
- `"Job Search 2026 | 4 active | 2 interviews pending | Drop a JD to screen"`
- `"Job Search 2026 | 2 active | Setup complete | Drop a JD to screen"`
- `"Job Search 2026 | 0 active | Profile refresh in progress | Drop a JD to screen"`

Update the `command` field in `.claude/settings.json` `statusLine` to reflect the current state using this format. The command runs as a shell `printf` so keep it a single-line string with no embedded newlines.
