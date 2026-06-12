---
name: resume-generation-rules
description: "MIGRATED — resume generation rules now live in skills/resume-generation/ (cover-letter rules in skills/cover-letter/)"
metadata: 
  node_type: memory
  type: feedback
---

**Migrated to versioned skills.** Resume generation rules live in `$APP_DIR/skills/resume-generation/` — read the pinned version per its `skill.yaml` (interactive sessions: prefer `draft.md` if present), plus the policies it lists (factuality, evidence-grounding, company-descriptors, storage-routing).

Cover letter rules live in `$APP_DIR/skills/cover-letter/`.

Do not add new rules here — tell Claude "draft skill resume-generation" to propose changes.
