Generate a job search status report.

Read `$APP_DIR/.env` and check `DATA_BACKEND`. Then load pipeline data using the appropriate method:
- **OB1 active** (`DATA_BACKEND=ob1`): call `get_pipeline(status=null)` to fetch all applications, and `get_overdue_followups()` for past-due follow-ups. Derive all metrics from those MCP results.
- **Fallback** (local): read `$APPLICANT_DIR/application-tracker.md` (and `application-tracker-closed.md` if it exists).

Produce a clean markdown summary covering:

1. **Pipeline by status** — count of applications in each state (Applied, Screening, Phone Interview, Technical Screen, Panel, Offer, etc.)
2. **Past-due follow-ups** — rows where Next Action date is before today's date; list them with company, role, and the overdue action
3. **Top priority active applications** — all Priority ⭐️⭐️⭐️ rows with their current status and next action
4. **Recent additions** — applications added in the last 14 days
5. **Response rate** — (phone screens + interviews received) ÷ applications submitted in the last 30 days (express as a fraction if count is small)

Output as clean markdown. Suitable for pasting into a weekly review note or sharing as a summary.

Do not ask clarifying questions. Read the tracker and generate the report.
