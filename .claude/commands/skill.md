Manage versioned skills, policies, and workflows (see `$APP_DIR/skills/README.md` for the format spec).

**Usage:** `/skill <subcommand> [args]`

**Subcommands:**

### `/skill list`
Read `$APP_DIR/skills/registry.yaml` and each entry's `skill.yaml`. Output a table: name, kind, status, pinned, latest, draft? (yes/no).

### `/skill show <name> [version]`
Print the requested version of the entry. Default version: what this session would use — `draft.md` if present, else the `pinned` version from `skill.yaml`.

### `/skill draft <name>`
Start a revision (**requires DEV_MODE=true** — the standard blocking protocol applies if the hook fires):
1. If `draft.md` already exists, show it and ask whether to continue editing it instead
2. Copy the **pinned** version file to `<entry>/draft.md`
3. Add an HTML comment at the top: `<!-- DRAFT started YYYY-MM-DD — rationale: [why this revision exists] -->` (ask the user for the rationale if not given)
4. Apply the requested changes to `draft.md`
5. Announce: subsequent interactive work uses the draft ("using DRAFT <name>")

### `/skill diff <name>`
Run `diff <entry>/<pinned>.md <entry>/draft.md` and summarize the changes. Error if no draft exists.

### `/skill promote <name> [--pin]`
Promote the draft to the next version (**requires DEV_MODE=true**):
1. Error if no `draft.md` exists
2. **Test gate:** run `cd "$APP_DIR/webapp/backend" && .venv/bin/pytest tests/test_runtime_registry.py tests/test_runtime_resolution.py tests/test_skill_content_hygiene.py -q` — abort the promotion if it fails
3. Determine next version: highest existing `vN` + 1
4. Remove the draft rationale comment, `git mv`-equivalent: write `draft.md` content to `v(N+1).md`, delete `draft.md`
5. Update `skill.yaml`: set `latest: v(N+1)`; append a changelog entry `{version, date, summary}`; set `pinned: v(N+1)` **only if `--pin` was given** (pinning is what webapp/non-interactive mode executes)
6. Re-run the test gate (registry consistency now includes the new file)
7. **Commit all touched files together in ONE manual commit** (per `memory/feedback_commits.md`) — message: `skill(<name>): promote draft to v(N+1)[, pin]` with a body summarizing the rule change
8. Record the promotion: append a `promotion` event via `python3 -c` calling `runtime.events.record_event` or by writing the equivalent JSONL line to `$APP_DIR/.runtime-events/<date>.jsonl`

**Rules:**
- Never edit a committed `vN.md` — all changes go through draft → promote
- `pinned` must never point at `draft`
- When the user gives procedural feedback on a migrated area (resume rules, JD screening, interview prep, storage routing, domain connection), propose `/skill draft` on the relevant entry instead of editing old `memory/feedback_*` files
