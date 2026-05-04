---
name: DEV_MODE — never auto-toggle
description: Claude must never set or unset DEV_MODE in .env; always prompt the user to do it manually
type: feedback
---

Never automatically set or unset `DEV_MODE` in `.env`, even when a task clearly requires APP_DIR write access.

**Why:** DEV_MODE is a deliberate safety gate. Auto-toggling it removes the user's control over when APP_DIR is writable. The user experienced this as unexpected behavior and wants manual control.

**How to apply:** When a task requires DEV_MODE=true and it is currently false:
1. State which file would be written and what change is needed
2. Tell the user DEV_MODE is off and they need to enable it manually in `.env`
3. Offer three paths: (a) enable DEV_MODE and reply "continue", (b) skip this step, (c) cancel
4. Wait. Do not attempt the write. Do not edit `.env` yourself.

When the user replies "continue", retry the blocked operation immediately.
When all APP_DIR edits are done, remind the user to set DEV_MODE=false again.
