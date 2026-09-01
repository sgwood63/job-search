Audit an application folder for completeness.

Read `$APP_DIR/.env` and resolve `DATA_BACKEND` (default: `local`). Apply routing per the policy `policies/storage-routing` for all APPLICANT file operations.

**Usage:** `/audit [folder-name] [--tier=folder|release|submission|all]`
If no folder name is given:
- **OB1**: call `get_pipeline(status=null)`, present the `folder_prefix` values, and ask which to audit.
- **Local**: list folders in `$APPLICANT_DIR/applications/` and ask which to audit.

## Tiers

The audit is staged so each check runs at the earliest point it can pass, rather than all at once just before submission (which is too late — `/apply` is a post-hoc recorder, so nothing at submission time can prevent a defect).

| Tier | Runs at | Blocking? |
|---|---|---|
| `folder` | Gate 1 — end of `workflows/process-jd` | No — advisory; must never halt an ingest run |
| `release` | Gate 2 — `skills/resume-generation`, post-`.md` and post-PDF | **Yes** — last gate before the artifact is handed over |
| `submission` | `/apply`, after the user has submitted | No — advisory |
| `all` | Manual invocation (default) | Reports everything |

## Step 1 — Run the mechanical checks

```bash
bash "$APP_DIR/scripts/audit-application.sh" <folder-name> [--tier=...]
```

The script is deterministic and covers everything verifiable by pattern: file presence, resume filename convention, `.md`/`.pdf` basename match, required section headings, and **JD completeness** (Required-bullet count in `jd-*.md` vs `job-description.md`, which catches a lossy capture that still reads as natural prose).

Exit codes: `0` no failures, `1` one or more failures, `2` usage or environment error.

## Step 2 — Judgment checks the script cannot make

Read the files and assess:

- [ ] **`jd-*.md` is genuinely verbatim** — it should read as the original posting, not a paraphrase, bullet summary, or restructured version. The script's bullet-count check catches truncation; it cannot detect rewording.
- [ ] **Company Research / Company & Market Context contain real findings**, not placeholders. Verify the `> Sources:` blockquote cites actual retrieved pages.
- [ ] **Notes carry a Process section** with hiring-process steps, and at least one Interview Prep section once interviews are underway. (Quality — warn only.)
- [ ] **Fit assessment is scored against the complete requirement set.** If the script flagged a bullet-count mismatch, the fit assessment and any generated resume were both built on incomplete requirements and must be redone after re-capturing the JD.

## Step 3 — Notes schema

Either `notes.md` or `notes-index.md` satisfies the notes requirement:

- **`notes-index.md`** (OB1, v4+ model) — identity/provenance header plus the `## OB1 Thought Keys` manifest. It is the input manifest for `skills/application-summary` and `skills/interview-prep`, which retrieve thoughts by ID. It carries **no status fields**; status lives in `js_applications`.
- **`notes.md`** — the rich human-readable document. When present as the primary notes file, it should carry Fit Assessment, JD Analysis, Resume Strategy, and Company Research.

Both may coexist. Do not treat a missing `notes-index.md` as a failure for an application created under the older model.

## Step 4 — Tracker check

- **OB1**: `get_pipeline(status=null)` — confirm a row exists with matching `folder_prefix`.
- **Local**: confirm the company appears in `$APPLICANT_DIR/application-tracker.md`.

Report the current status. Do **not** treat status `applied` as a failure — auditing an already-submitted application is normal and expected.

## Output

`PASS` or `FAIL` with specific items called out, separating blocking failures from advisory warnings. Note which tier was run. If invoked at Gate 1 or from `/apply`, state explicitly that findings are advisory and nothing was blocked.

Binary file sizes are unreliable in OB1 — `list_files` reports 0 bytes for PDFs regardless of content. Treat a `.pdf` key's existence as sufficient; verify page count by generating or opening the file, never from reported size.
