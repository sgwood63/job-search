Audit an application folder for completeness before recording a submission.

**Usage:** `/audit [folder-name]`
If no folder name is given, list all folders in `$APPLICANT_DIR/applications/` and ask which to audit.

For the specified folder at `$APPLICANT_DIR/applications/[folder-name]/`:

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
- [ ] Company appears in `$APPLICANT_DIR/application-tracker.md` Active Applications table
- [ ] Status is not already "Applied" (would be a duplicate submission)

**Output:** PASS or FAIL with specific missing items called out. If PASS, print the exact tracker row to add or update for this submission.
