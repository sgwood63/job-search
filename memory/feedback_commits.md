---
name: Commit discipline — multi-file changes together
description: When a task touches both memory/ and other APP_DIR files, commit everything manually before finishing the response
type: feedback
---

When a task changes files in both `memory/` and elsewhere in APP_DIR (e.g., CLAUDE.md, workflow.md, scripts/), commit all changed files together manually at the end of the task — before the response ends.

**Why:** The Stop hook auto-commits `memory/` changes after every response. If non-memory APP_DIR files are left uncommitted, the hook creates a split: one commit for memory/ and a separate commit for the other files. Multi-file changes that belong to one logical change must ship as one commit.

**How to apply:** At the end of any task that modifies files in both memory/ and elsewhere in APP_DIR:
1. Stage all changed files together
2. Create one commit covering all of them
3. The Stop hook will then find no uncommitted memory/ changes and skip its auto-commit
