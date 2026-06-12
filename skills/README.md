# Versioned Skills, Policies, and Workflows

Procedural knowledge for the job-search system lives here as **versioned documents** executed by the agent runtime (`webapp/backend/runtime/`) and by interactive Claude Code sessions.

## Layout

```
skills/      — generative procedures (jd-evaluation, resume-generation, cover-letter, interview-prep)
policies/    — cross-cutting rules composed into every skill run that lists them (factuality, evidence-grounding, company-descriptors, storage-routing)
workflows/   — multi-step orchestrations that invoke skills by name (create-application, prepare-interview)
```

Each entry is a directory containing:

- `skill.yaml` — manifest: name, kind, status, `pinned` (the version non-interactive/webapp mode executes), `latest`, referenced policies, informal input/output contract, changelog
- `v1.md`, `v2.md`, … — **immutable once committed**; the body of the procedure, with `memory/`-style frontmatter (`name`, `description`)
- `draft.md` — exists only while a revision is in progress

`skills/registry.yaml` enumerates all entries; per-entry `skill.yaml` owns everything else.

## Version resolution

| Mode | Resolution |
|---|---|
| `webapp` (non-interactive) | explicit version or `pinned`; `draft` is refused |
| `interactive` (Claude Code session) | explicit version honored; else `draft.md` if present (announce "using DRAFT <name>"); else `pinned` |

## Change flow

All changes go through draft → promote (never edit a committed `vN.md`):

1. `/skill draft <name>` — copies the pinned version to `draft.md` (requires `DEV_MODE=true`)
2. Edit `draft.md`; interactive sessions exercise it on real work
3. `/skill promote <name> [--pin]` — runs the runtime test gate, renames `draft.md` → `v(N+1).md`, updates `skill.yaml` `latest` + changelog (`pinned` only moves with `--pin`), and commits everything in one commit

## Authoring rules

- Markdown hygiene applies (`scripts/check-md-hygiene.sh`): refer to "the applicant"/"the user" (never a name); use `$APP_DIR`/`$APPLICANT_DIR` variables, never absolute paths
- Skills reference policies by name in `skill.yaml` `policies:` — do not restate policy text inside a skill
- Workflows reference skills by name ("screen via skill `jd-evaluation`") — do not inline skill procedure text
