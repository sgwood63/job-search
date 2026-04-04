---
name: feedback_company_lookup
description: When user mentions a company not immediately in context, check application-tracker.md first; if multiple positions exist for that company, confirm which is relevant before proceeding
type: feedback
---

When the user references a company that is not already part of the current conversation context, always check `application-tracker.md` first to see if we have worked on it before.

**Why:** Avoids incorrect assumptions about which role/application is relevant, especially when we have multiple touchpoints with the same company (e.g., HockeyStack had Solutions Consultant + Forward Deployed Consultant).

**How to apply:**
1. Read `application-tracker.md` to find all entries for that company
2. If there is exactly one entry, proceed with that context
3. If there are multiple entries (different roles or dates), confirm with the user which position is relevant — and include "new position" as an option
4. If there is no entry, treat it as a new company/JD to screen
