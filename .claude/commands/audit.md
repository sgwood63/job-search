Audit an application folder for completeness before recording a submission.

Read `$APP_DIR/.env` and resolve `DATA_BACKEND` (default: `local`). Apply routing rule per `memory/feedback_ob1_integration.md` for all APPLICANT file operations below.

**Usage:** `/audit [folder-name]`
If no folder name is given:
- **OB1**: call `get_pipeline(status=null)` and list the `folder_prefix` values; present them and ask which to audit.
- **Local**: list all folders in `$APPLICANT_DIR/applications/` and ask which to audit.

For the specified folder (key prefix `applications/[folder-name]/` in OB1, or `$APPLICANT_DIR/applications/[folder-name]/` locally):

Read folder files:
- **OB1**: `get_file('applications/[folder-name]/job-description.md')`, `get_file('applications/[folder-name]/notes.md')`; use `list_files('applications/[folder-name]/')` to check for resume files.
- **Local**: read directly from `$APPLICANT_DIR/applications/[folder-name]/`.

**Required — FAIL if missing:**
- [ ] `job-description.md` exists with a non-empty JD Analysis section
- [ ] `notes.md` exists with all required sections: Table of Contents, JD Analysis, Fit Assessment, Resume Strategy, Company Research
- [ ] At least one `*.md` resume file (named `[Name]_[Role].md`)
- [ ] At least one `*.pdf` resume file with matching name

**Quality — WARN if missing:**
- [ ] `notes.md` has a Process section with hiring process steps
- [ ] `notes.md` has at least one Interview Prep section
- [ ] Company Research section is not empty or a placeholder
- [ ] PDF page count verified — run: `pdfinfo [file.pdf] | grep Pages`

**Tracker check:**
- **OB1**: call `get_pipeline(status=null)` and confirm an application row exists with matching `folder_prefix`; check that its status is not already `applied`.
- **Local**: confirm company appears in `$APPLICANT_DIR/application-tracker.md` Active Applications table and status is not already "Applied".

**Output:** PASS or FAIL with specific missing items called out. If PASS, print the exact tracker row to add or update for this submission.
