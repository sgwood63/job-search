---
name: feedback-application-disambiguation
description: When a lookup returns multiple applications, or the returned application's title doesn't match what the user specified, always pause and ask before proceeding
metadata:
  type: feedback
---

When a pipeline or semantic search returns more than one application matching a company name (or other ambiguous query), always pause and ask the user which application they mean before proceeding with any action.

Also pause when `get_application` returns a single result whose role title does not match the title the user specified — do not assume it is close enough. Look up the full pipeline for that company first, then present all matches.

**Why:** `get_application("Hover")` returned only "Senior Sales Engineer" but the user asked about "Senior Solutions Architect." Proceeding without flagging the mismatch caused the wrong resume to be edited and required a restore. There were two Hover applications total; the lookup surfaced only one.

**How to apply:** Present each candidate application as a numbered list with exactly these fields per entry:

```
1. Company — Role Title | Created | Profile | Status
```

Example:
```
1. Hover — Senior Sales Engineer | 2026-06-12 | presales-se | pending-review
2. Hover — Senior Solutions Architect | 2026-06-05 | post-sales-se | resume-ready
```

Then ask: "Which one?" — do not proceed until the user selects.

Apply whenever:
- A lookup returns 2+ results for the same company
- The lookup returns 1 result but the role title doesn't match what the user specified
- The user's reference is ambiguous enough that multiple applications could match
