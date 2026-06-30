Perform a structured scoping pass before making repository-evolution changes (refactors, new integrations, skill/workflow updates, schema changes, etc.). This session is already unblocked for planning — this command maps the impact before any code is written.

## Steps

**1. Orient with the graph (codebase-memory-mcp — do not skip)**

First, confirm the indexed project name:
- `list_projects()` — find the correct project name to use in subsequent calls. If the project is not listed, run `index_repository` before proceeding.

Then run in parallel:
- `get_architecture(aspects=["overview", "structure"])` — project layout and module boundaries
- `search_graph(name_pattern=<primary symbol or area>)` — locate the relevant functions/classes

Then follow with:
- `trace_path(function_name=<entry_point>, mode="calls")` for each key entry point — understand call chains without reading every file
- `search_code(pattern=<keyword>)` for any cross-cutting terms not surfaced by the graph

Use graph results to identify which files will change. Only `Read` files that the graph cannot answer — graph queries are cheap; full file reads are expensive.

**2. Produce a scoping summary**

Output:
- **Files that will change** — path + why
- **Call chains / data flow** relevant to the change
- **Tests** covering those paths (if any)
- **Risks / unknowns** — missing coverage, implicit contracts, cross-service effects
- **Proposed approach** — one paragraph

**3. Confirm with user before proceeding**

Present the summary. Ask: "Does this match your intent? Proceed with implementation?"

Wait for confirmation.

**4. Write the session marker**

Once confirmed, run this pre-approved command to unblock APP_DIR writes for the rest of this session:

```bash
bash scripts/write-scope-marker.sh
```

After this runs, `scope-before-write.py` will allow all APP_DIR writes for this session. The marker is session-scoped — it does not carry over to new sessions.

Do not ask clarifying questions before starting. Begin with step 1 immediately.
