Audit an application folder for completeness before recording a submission.

Read `$APP_DIR/.env` and resolve `DATA_BACKEND` (default: `local`). Apply routing rule per `memory/feedback_ob1_integration.md` for all APPLICANT file operations below.

**Usage:** `/audit [folder-name]`
If no folder name is given:
- **OB1**: call `get_pipeline(status=null)` and list the `folder_prefix` values; present them and ask which to audit.
- **Local**: list all folders in `$APPLICANT_DIR/applications/` and ask which to audit.

For the specified folder (key prefix `applications/[folder-name]/` in OB1, or `$APPLICANT_DIR/applications/[folder-name]/` locally):

Read folder files:
- **OB1**: `get_file('applications/[folder-name]/job-description.md')`, `get_file('applications/[folder-name]/notes.md')`; use `list_files('applications/[folder-name]/')` to check for all files including `jd-*.md` and resume files.
- **Local**: read directly from `$APPLICANT_DIR/applications/[folder-name]/`.

**Required — FAIL if missing:**
- [ ] `jd-*.md` exists (verbatim raw JD source file — OB1: check list_files output for any key matching `jd-*.md`). If it exists, read it and verify it contains the full JD — it should read as natural prose (the original posting), NOT as reformatted or summarized markdown. If it appears to be a paraphrase, bullet summary, or restructured version, FAIL with: "jd-*.md appears summarized — must be verbatim JD text."
- [ ] `job-description.md` exists with a non-empty JD Analysis section
- [ ] `notes.md` or `notes-index.md` exists (OB1 flow uses `notes-index.md`; local flow uses `notes.md`). For `notes.md`: must have all required sections: Table of Contents, JD Analysis, Fit Assessment, Resume Strategy, Company Research.
- [ ] At least one `*.md` resume file (named `[Name]_[Role].md`)
- [ ] At least one `*.pdf` resume file with matching name — **OB1 mode: presence only** — a `.pdf` key existing in `list_files` output is sufficient; do NOT use reported file size to assess validity. OB1 reports 0 bytes for binary/PDF files regardless of actual content. The file is valid if the key exists.

**Quality — WARN if missing:**
- [ ] `job-description.md` Company & Market Context section has the full four-part structure: business overview paragraph, `Division / Team:` line, `Products / Platform:` bullet list with links, `Market & Strategic Context:` narrative (should be 100+ words), and a `> Sources:` blockquote. If any of these parts is missing, warn: "Company & Market Context incomplete — missing: [list what's absent]."
- [ ] `notes.md` (local) or `notes-index.md` (OB1) has a Process section with hiring process steps
- [ ] `notes.md` has at least one Interview Prep section
- [ ] Company Research section is not empty or a placeholder
- [ ] PDF page count — **Local mode only**: run `pdfinfo [file.pdf] | grep Pages`. Skip in OB1 mode (binary sizes are unreliable; verify page count by opening the PDF directly).

**Tracker check:**
- **OB1**: call `get_pipeline(status=null)` and confirm an application row exists with matching `folder_prefix`; check that its status is not already `applied`.
- **Local**: confirm company appears in `$APPLICANT_DIR/application-tracker.md` Active Applications table and status is not already "Applied".

**Output:** PASS or FAIL with specific missing items called out. If PASS, print the exact tracker row to add or update for this submission.
