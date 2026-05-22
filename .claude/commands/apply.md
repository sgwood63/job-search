Record an application submission atomically — updates both tracker and notes.md in one step.

**Usage:** `/apply [company] [role] [date] [portal-url?]`
**Example:** `/apply "Middesk" "Solutions Architect" "2026-05-02" "https://boards.greenhouse.io/..."`

**Steps:**
1. Run `/audit` on the matching application folder first. If audit fails, stop and report — do not modify any files.
2. Update `$APPLICANT_DIR/application-tracker.md`:
   - Set `Status` to `Applied`
   - Set `Status Detail` to `Applied [date]` (with portal name if known, e.g., `Applied 2026-05-15 via Greenhouse`)
   - Set Next Action to `Follow up [date + 14 days]`
   - Confirm Priority is set
3. Update `$APPLICANT_DIR/applications/[folder]/notes.md`:
   - Set `**Status:**` to `Applied`
   - Set `**Status Detail:**` to `Applied [date]` (matching the tracker)
   - Append to the existing `## Application Log` section:
     `- [date] — Applied via [portal name] ([URL if provided]); resume: [filename].pdf`
4. Report: "Applied to [Company] — [Role] on [date]. Tracker and notes.md updated. Follow up due [date+14]."

If the company/role is ambiguous (multiple tracker entries), confirm which one before proceeding.
Do not modify any files until audit passes.
