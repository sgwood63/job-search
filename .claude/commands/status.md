Generate a job search status report.

Read `$APPLICANT_DIR/application-tracker.md` and produce a clean markdown summary covering:

1. **Pipeline by status** — count of applications in each state (Applied, Screening, Phone Interview, Technical Screen, Panel, Offer, etc.)
2. **Past-due follow-ups** — rows where Next Action date is before today's date; list them with company, role, and the overdue action
3. **Top priority active applications** — all Priority ⭐️⭐️⭐️ rows with their current status and next action
4. **Recent additions** — applications added in the last 14 days
5. **Response rate** — (phone screens + interviews received) ÷ applications submitted in the last 30 days (express as a fraction if count is small)

Output as clean markdown. Suitable for pasting into a weekly review note or sharing as a summary.

Do not ask clarifying questions. Read the tracker and generate the report.
