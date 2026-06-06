Load interview preparation context for a specific application.

**Usage:** `/interview [company] [stage?]`
**Examples:**
- `/interview Middesk`
- `/interview Middesk "technical screen"`

**Steps:**
1. Run `/context` to load base session state (applicant criteria, pipeline, memory).
2. Locate the application — use the first available method:
   - **OB1 active** (open-brain MCP connected): call `get_application("[company]")` — returns folder_prefix, profile, and linked file keys.
   - **Fallback**: search `$APPLICANT_DIR/applications/` for a folder matching [company] (case-insensitive, partial match OK).
   - If multiple matches exist, ask which one.
3. Read from the application folder — use the first available method for each file:
   - **OB1 active**: `get_file('applications/[folder]/job-description.md')`, `get_file('applications/[folder]/notes.md')`
   - **Fallback**: read files directly from `$APPLICANT_DIR/applications/[folder]/`
   - Also read: `$APPLICANT_DIR/profiles/[matched-profile].md` — positioning strategy (from object store or local)
4. Output an interview brief:
   - **Stage:** what interview type this is (from notes.md Process section)
   - **Key talking points** for this specific stage
   - **Questions to ask** the interviewer
   - **What NOT to bring up** (from notes.md Differentiators section if present)
   - **Signals to watch for** (what they care about based on JD and research)
5. End with: "Interview prep loaded for [Company] — [Stage]. What aspect do you want to work through?"

If the stage is not specified, use the next upcoming stage based on the Process section in notes.md.
