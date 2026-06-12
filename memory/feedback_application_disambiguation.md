---
name: feedback-application-disambiguation
description: When a search returns multiple applications for a company, always ask which one before proceeding — show a formatted list with key fields
metadata:
  type: feedback
---

When a pipeline or semantic search returns more than one application matching a company name (or other ambiguous query), always pause and ask the user which application they mean before proceeding with any action.

**Why:** The user was asked about "the Hover application" but there were two Hover roles (Senior Sales Engineer presales and Senior Solutions Architect post-sales). Proceeding on the wrong one wastes time and generates the wrong resume.

**How to apply:** Present each candidate application as a numbered list with exactly these fields per entry:

```
1. Company — Role Title | Created | Profile | Status
```

Example:
```
1. Hover — Senior Sales Engineer | 2026-06-12 | presales-se | pending-review
2. Hover — Senior Solutions Architect | 2026-06-05 | post-sales-se | pending-review
```

Then ask: "Which one?" — do not proceed until the user selects.

Apply whenever: a `get_pipeline`, `search_applications_semantic`, or any other lookup returns 2+ results for the same company, or when the user's reference is ambiguous enough that multiple applications could match.
