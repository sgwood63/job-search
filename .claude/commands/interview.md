Load interview preparation context for a specific application.

**Usage:** `/interview [company] [stage?]`
**Examples:**
- `/interview Middesk`
- `/interview Middesk "technical screen"`

**Steps:**
1. Run `/context` to load base session state (applicant criteria, pipeline, memory).
2. Search `$APPLICANT_DIR/applications/` for a folder matching [company] (case-insensitive, partial match OK). If multiple matches exist, ask which one.
3. Read from the application folder:
   - `job-description.md` — role details and requirements
   - `notes.md` — full file, especially Interview Prep sections and Process section
   - `$APPLICANT_DIR/profiles/[matched-profile].md` — positioning strategy for this profile
4. Output an interview brief:
   - **Stage:** what interview type this is (from notes.md Process section)
   - **Key talking points** for this specific stage
   - **Questions to ask** the interviewer
   - **What NOT to bring up** (from notes.md Differentiators section if present)
   - **Signals to watch for** (what they care about based on JD and research)
5. End with: "Interview prep loaded for [Company] — [Stage]. What aspect do you want to work through?"

If the stage is not specified, use the next upcoming stage based on the Process section in notes.md.
