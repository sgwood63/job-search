Load the job search session context. Steps:

1. `$APP_DIR/.env` — resolve $APP_DIR, $APPLICANT_DIR, DATA_BACKEND, DEV_MODE.
2. **OB1 check** (if DATA_BACKEND=ob1): verify `mcp__job_search__*` tools appear in the deferred tool list. If absent → **hard stop**: tell the user "OB1 is configured but job-search MCP tools are not connected. Please restart Claude Code, then re-run `/context`." Do not proceed.
3. **In parallel**, load the two applicant files:
   - **OB1 path**: `get_file('applicant.md')` + `get_file('memory/APPLICANT-MEMORY.md')`
   - **Local path**: `Read($APPLICANT_DIR/applicant.md)` + `Read($APPLICANT_DIR/memory/APPLICANT-MEMORY.md)`
4. Output a session briefing (10 lines max):
   - Applicant identity confirmed (name, active profiles)
   - OB1 active or local fallback mode
   - $APPLICANT_DIR resolved correctly
   - DEV_MODE status
   - End with: "Context loaded. Ready."

**Pipeline state is not loaded here.** Run `/status` to see active applications, overdue follow-ups, and pipeline counts.

Do not ask clarifying questions. Do not wait for confirmation. Just load and brief.
