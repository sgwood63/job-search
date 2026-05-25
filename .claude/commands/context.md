Load the full job search session context. Read these files in order and synthesize:

1. `$APP_DIR/.env` — resolve $APP_DIR, $APPLICANT_DIR, OB1_MCP_URL (if set)
2. `$APPLICANT_DIR/applicant.md` — applicant identity, location criteria, compensation targets, deal-breakers. When OB1 is active: use `get_file('applicant.md')` via the open-brain MCP.
3. **Pipeline** — use the first available source:
   - **OB1 active** (OB1_MCP_URL set in .env and open-brain MCP connected): call `get_pipeline()` to get active/pending applications and `get_overdue_followups()` for past-due items. Flag: (a) past-due follow-up dates, (b) interview-scheduled/interviewed/exercise/offer status rows, (c) priority=3 (high) rows, (d) pending-review rows.
   - **Fallback**: read `$APPLICANT_DIR/application-tracker.md` — flag the same items.
4. `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md` — applicant-specific rules. When OB1 is active: use `get_file('memory/APPLICANT-MEMORY.md')`.
5. `$APP_DIR/memory/MEMORY.md` — process rules index (always read from APP_DIR).

After reading, output a session briefing (10 lines max):
- Active pipeline count, pending-review count, any past-due follow-ups, most urgent next action
- Whether OB1 is active or fallback mode
- Confirm $APPLICANT_DIR resolved correctly
- End with: "Context loaded. Ready."

Do not ask clarifying questions. Do not wait for confirmation. Just load and brief.
