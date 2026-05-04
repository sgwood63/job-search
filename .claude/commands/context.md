Load the full job search session context. Read these files in order and synthesize:

1. `$APP_DIR/.env` — resolve $APP_DIR and $APPLICANT_DIR path variables
2. `$APPLICANT_DIR/applicant.md` — applicant identity, location criteria, compensation targets, deal-breakers
3. `$APPLICANT_DIR/application-tracker.md` — current pipeline; flag: (a) any follow-up dates past today, (b) anything in an Interview Pipeline stage, (c) active Priority ⭐️⭐️⭐️ applications
4. `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md` — applicant-specific rules
5. `$APP_DIR/memory/MEMORY.md` — process rules index

After reading, output a session briefing (10 lines max):
- Active pipeline count, any past-due follow-ups, most urgent next action
- Confirm $APPLICANT_DIR resolved correctly
- End with: "Context loaded. Ready."

Do not ask clarifying questions. Do not wait for confirmation. Just load and brief.
