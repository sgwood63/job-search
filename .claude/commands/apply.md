Record an application submission atomically — updates both tracker and notes.md in one step.

**Usage:** `/apply [company] [role] [date] [portal-url?]`
**Example:** `/apply "Middesk" "Solutions Architect" "2026-05-02" "https://boards.greenhouse.io/..."`

**Steps:**
1. Run `/audit` on the matching application folder first. If audit fails, stop and report — do not modify any files.
2. **Update pipeline state** — use the first available method:
   - **OB1 active** (open-brain MCP connected): call `update_application_status(id, 'applied', 'Applied [date] via [portal]', follow_up_date)` where follow_up_date = date + 14 days. Look up the application id via `get_application("[company]")` first.
   - **Fallback**: update `$APPLICANT_DIR/application-tracker.md` — set `Status` to `Applied`, `Status Detail` to `Applied [date]` (with portal name if known), `Next Action` to `Follow up [date + 14 days]`, confirm Priority is set.
3. **Update notes.md** — use the first available method:
   - **OB1 active**: `get_file('applications/[folder]/notes.md')` → edit in memory → `upload_file('applications/[folder]/notes.md', updated, 'text/markdown')`.
   - **Fallback**: edit `$APPLICANT_DIR/applications/[folder]/notes.md` directly.
   - In both cases: set `**Status:**` to `Applied`, set `**Status Detail:**` to `Applied [date]`, append to `## Application Log`: `- [date] — Applied via [portal name] ([URL if provided]); resume: [filename].pdf`
4. Report: "Applied to [Company] — [Role] on [date]. Pipeline and notes.md updated. Follow up due [date+14]."

If the company/role is ambiguous (multiple tracker entries), confirm which one before proceeding.
Do not modify any files until audit passes.
