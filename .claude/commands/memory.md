Navigate or update the job search memory system.

**Usage:**
- `/memory` — list all memory files with one-line summaries
- `/memory read [name]` — read a specific memory file (partial name OK)
- `/memory update` — run the end-of-session memory sync checklist
- `/memory add [topic]` — create or append a new memory note on a topic

---

**No argument (list mode):**
Read `$APP_DIR/memory/MEMORY.md` and `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md`.
Output: two-column table of all memory files, their type (feedback / project / reference), and last-updated date (from file frontmatter or git log).

---

**`/memory read [name]`:**
Find the matching file in `$APP_DIR/memory/` or `$APPLICANT_DIR/memory/` and display its full contents. Partial name match is fine (e.g., `/memory read domain` finds `feedback_domain_connection.md`).

---

**`/memory update` (end-of-session mode):**
1. Ask: "What changed this session that should be remembered?"
2. Wait for the user's answer.
3. Determine which memory file(s) to update based on the answer — process rules go in `$APP_DIR/memory/`, applicant-specific context in `$APPLICANT_DIR/memory/`.
4. Update the file(s):
   - `$APP_DIR/memory/` files: always written locally via Edit/Write tool (these are git-tracked tooling files, not subject to DATA_BACKEND).
   - `$APPLICANT_DIR/memory/` files: check `DATA_BACKEND` in `.env`. If `ob1`, use `upload_file('memory/<filename>', content, 'text/markdown')` instead of writing locally.
5. For `$APP_DIR/memory/` changes, run the memory sync:
```bash
source "$APP_DIR/.env"
git -C "$APP_DIR" add memory/
git -C "$APP_DIR" commit -m "Update memory: [what changed]"
CLAUDE_MEM="$HOME/.claude/projects/$(echo "$APP_DIR" | sed 's|/|-|g')/memory/"
cp "$APP_DIR/memory/"*.md "$CLAUDE_MEM"
```
6. Report: "Memory updated and synced."

---

**`/memory add [topic]`:**
Create a new feedback file in `$APP_DIR/memory/` using the naming pattern `feedback_[topic].md` or `project_[topic].md`. Write the correct frontmatter (name, description, type) and content. After writing, add it to the index in `$APP_DIR/memory/MEMORY.md`, then run the sync from `/memory update` step 5.

For applicant-specific memory topics (personal constraints, preferences, role rules) that belong in `$APPLICANT_DIR/memory/`, check `DATA_BACKEND` first: if `ob1`, use `upload_file('memory/<filename>', content, 'text/markdown')`; otherwise write locally to `$APPLICANT_DIR/memory/<filename>`.
