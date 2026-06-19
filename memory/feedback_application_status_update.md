---
name: application-status-update-rule
description: "MIGRATED — status update two-file rule and Application Log format now live in workflows/create-application/"
metadata: 
  node_type: memory
  type: feedback
---

**Migrated to versioned skills.** The status-update rules — two-target update (tracker + notes.md) for all transitions, duplicate-folder handling, Application Log format (no `## Submission Log` section) — live in `$APP_DIR/workflows/create-application/` ("Status changes — Two-File Rule"). Read the pinned version per its `skill.yaml`.

Do not add new rules here — tell Claude "draft skill create-application" to propose changes.
