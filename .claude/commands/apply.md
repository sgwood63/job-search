Record an application submission that has already happened — updates pipeline state and notes in one step.

**Usage:** `/apply [company] [role] [date] [portal-url?]`
**Example:** `/apply "Middesk" "Solutions Architect" "2026-05-02" "https://boards.greenhouse.io/..."`

Also triggered conversationally — when the user says "applied", "submitted it", or similar about a known application, run this without being asked.

## This command is a recorder, not a gate

`/apply` runs **after** the user has submitted on the company's portal. It cannot prevent anything, and it must never refuse to record a submission that already happened — a stale pipeline is worse than an incomplete folder. Completeness is enforced earlier, at Gate 1 (`workflows/process-jd`) and Gate 2 (`skills/resume-generation`), which is the last point before the resume is handed over.

**Never block. Never stop and refuse to write.** Record first, report gaps second.

## Steps

1. **Identify the application.** `get_application("[company]")` (OB1) or search the tracker (local). If 2+ applications match, pause and ask which — show a numbered list with Company — Role | Created | Profile | Status.

2. **Update pipeline state:**
   - **OB1 active:** `update_application_status(id, 'applied', 'Applied [date] via [portal]', follow_up_date)` where `follow_up_date` = date + 14 days.
   - **Local:** update `$APPLICANT_DIR/application-tracker.md` — `Status` → `Applied`, `Status Detail` → `Applied [date]` (with portal if known), `Next Action` → `Follow up [date + 14 days]`.

3. **Update notes:**
   - **OB1:** `get_file('applications/[folder]/notes.md')` → edit in memory → `upload_file(...)`. Set `**Status:**` to `Applied` and `**Status Detail:**` to `Applied [date]`. Append to `## Application Log`:
     `- [date] — Applied via [portal name] ([URL if provided]); resume: [filename].pdf. Follow up due [date + 14].`
     Create the `## Application Log` section if absent.
   - **Local:** same edits directly on the file.
   - Do **not** write status into `notes-index.md` — `js_applications` is the source of truth for status.

4. **Record the portal accurately.** The listing source and the submission portal are often different (a job board's "Apply Now" frequently hands off to the employer's own ATS). Record both when they differ. If the user did not say which portal they used, log the listing source and mark the portal unconfirmed rather than assuming — then ask.

   The ATS itself is signal worth capturing: a staffing/recruiting ATS (JobDiva, Bullhorn) alongside an hourly rate suggests a contract or contract-to-perm pipeline rather than a direct FTE requisition.

5. **Run the post-hoc audit** (advisory):

   ```bash
   bash "$APP_DIR/scripts/audit-application.sh" <folder-slug> --tier=submission
   ```

   This exits 0 by design. If anything is flagged, record it in `status_detail` and tell the user — but the submission is already recorded either way.

6. **Report:** "Applied to [Company] — [Role] on [date]. Pipeline and notes updated. Follow up due [date+14]." Then surface any residual audit findings and any open questions for the recruiter (location or eligibility, employment type, compensation).
