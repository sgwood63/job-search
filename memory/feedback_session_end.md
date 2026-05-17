---
name: Session end checklist — memory and status
description: At the end of every session, update applicant memory; applicant-setup-status.md is now auto-generated
type: feedback
---

At the end of every session, do the following without being asked:

1. **`applicant-setup-status.md` is auto-generated — no action needed.** The Stop hook runs `scripts/generate-setup-status.sh` after every Claude response, writing a fresh snapshot of active profiles, pipeline counts, high-priority items, and unverified tags from authoritative sources. Claude does not write this file.

2. **Update permanent memory in real-time, not at session end.** When a notable discovery occurs during the session (new constraint, changed preference, key finding about a company, resolved unverified item), update the appropriate file immediately (`$APPLICANT_DIR/memory/APPLICANT-MEMORY.md`, a profile content file, etc.). Do not batch these to session end.

3. **The statusLine is dynamic** — `scripts/status-line.sh` reads `application-tracker.md` live every 5 minutes. No manual update needed unless the script itself is broken.

**Why:** Session-end write steps are unreliable — sessions end abruptly, Claude forgets. Anything that can be generated from authoritative sources should be; anything Claude should record should be written immediately when discovered, not as a ritual.

**How to apply:** The only active session-end obligation is: if something important was learned this session and hasn't yet been recorded in permanent memory (`APPLICANT-MEMORY.md`, a profile file, etc.), write it now before the session ends.
