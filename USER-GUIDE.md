# User Guide — Slash Commands

This guide covers the slash commands available in Claude Code sessions for this job search system. Commands automate multi-step workflows so you don't have to orchestrate them manually.

**How to invoke:** Type `/command-name` (with any arguments) in a Claude Code session.

---

## Quick Reference

| Command | Usage | When to use |
|---------|-------|-------------|
| `/context` | `/context` | Session start — loads all applicant state |
| `/status` | `/status` | Weekly review — current pipeline snapshot |
| `/audit` | `/audit [folder-name]` | Before submitting — validates application folder |
| `/apply` | `/apply "Company" "Role" "date" [url]` | After submitting — records in tracker + notes.md |
| `/interview` | `/interview [company] [stage?]` | Before an interview — loads prep context |
| `/memory` | `/memory` or `/memory update` | End of session — navigate and sync memory |

---

## Session Workflow

```
Start session     → /context
Work on task      → (JD screening, resume, interview prep)
Submit app        → /audit → /apply
End session       → /memory update
Weekly check-in   → /status
```

---

## Command Details

### `/context`

Loads the full session state in one step — replaces manually reading 5+ files at session start.

**What it reads:**
- `.env` — resolves `$APP_DIR` and `$APPLICANT_DIR`
- `applicant.md` — criteria, compensation, deal-breakers
- `application-tracker.md` — pipeline state; flags past-due follow-ups and priority applications
- `APPLICANT-MEMORY.md` — applicant-specific rules
- `MEMORY.md` — process rules index

**Output:** A 10-line briefing: active pipeline count, any past-due follow-ups, most urgent next action, confirmation that paths resolved correctly.

**Use at:** The start of every session before working on any application.

---

### `/status`

Generates a current pipeline snapshot. Replaces the stale "Stats & Insights" section that used to be maintained manually in the tracker.

**Output includes:**
- Application count by status (Applied, Screening, Phone Interview, etc.)
- Past-due follow-ups with the overdue action
- All Priority ⭐️⭐️⭐️ applications with current status
- Applications added in the last 14 days
- Response rate for the last 30 days

**Use at:** Weekly review, or any time you want a quick summary of where things stand.

---

### `/audit [folder-name]`

Validates an application folder for completeness before you record a submission. This is a prerequisite for `/apply`.

**What it checks:**

*Required (FAIL if missing):*
- `job-description.md` with a non-empty JD Analysis section
- `notes.md` with: Table of Contents, JD Analysis, Fit Assessment, Resume Strategy, Company Research
- A `.md` resume file (`Name_Role.md`)
- A matching `.pdf` resume file

*Quality (WARN if missing):*
- `notes.md` has a Process section
- `notes.md` has at least one Interview Prep section
- Company Research section is not empty
- PDF page count verified

*Tracker check:*
- Company appears in Active Applications table
- Status is not already "Applied"

**Output:** PASS or FAIL with specific items called out. On PASS, prints the exact tracker row to use for `/apply`.

**Usage:**
```
/audit 2026-05-02-middesk-solutions-architect
```
If you omit the folder name, it lists all application folders and asks which to audit.

---

### `/apply "Company" "Role" "date" [portal-url]`

Records a submission atomically — updates both `application-tracker.md` and the application's `notes.md` in one step. Runs `/audit` automatically first and stops if it fails.

**What it updates:**

*Tracker:*
- Status → `Applied [date]`
- Next Action → `Follow up [date + 14 days]`

*notes.md:*
- Adds a `## Submission Log` section (after the header, before the TOC) with: date submitted, portal URL, resume filename used

**Usage:**
```
/apply "Middesk" "Solutions Architect" "2026-05-02"
/apply "Middesk" "Solutions Architect" "2026-05-02" "https://boards.greenhouse.io/middesk/jobs/123"
```

If the company matches multiple tracker entries, it asks which one before proceeding.

---

### `/interview [company] [stage?]`

Loads interview preparation context for a specific application in one step.

**What it reads:**
- `job-description.md` — role details and requirements
- `notes.md` — full file, especially Interview Prep and Process sections
- The matched profile's strategy file

**Output:**
- Stage summary (what type of interview this is)
- Key talking points for this specific stage
- Questions to ask the interviewer
- What NOT to bring up
- Signals to watch for based on the JD and company research

**Usage:**
```
/interview Middesk
/interview Middesk "technical screen"
```

If stage is not specified, uses the next upcoming stage from the Process section in `notes.md`.

---

### `/memory [subcommand]`

Navigates and updates the memory system.

**Subcommands:**

`/memory` — Lists all memory files with one-line summaries and types (feedback / project / reference).

`/memory read [name]` — Reads a specific file. Partial name match works:
```
/memory read domain        → reads feedback_domain_connection.md
/memory read session end   → reads feedback_session_end.md
```

`/memory update` — End-of-session sync. Asks what changed, updates the right files, commits to git, and syncs to `~/.claude/` so the live session picks up the changes.

`/memory add [topic]` — Creates a new memory file with correct frontmatter, adds it to the index, and syncs.

**Use at:** The end of any session where you want to preserve something for future sessions.

---

## Common Scenarios

### "I found a job — process it"
Just paste the URL or JD text. The automated workflow in `CLAUDE.md` handles everything: fetch, screen (Haiku), folder creation, resume generation (Sonnet), tracker update.

### "I'm about to submit an application"
```
/audit 2026-05-02-company-role
```
Review the PASS/FAIL output. Fix any failures, then:
```
/apply "Company" "Role" "2026-05-02" "https://portal-url"
```

### "I have a phone screen tomorrow"
```
/interview Company "recruiter screen"
```
Claude loads the job details, profile strategy, and your notes, then gives you a targeted brief.

### "Starting a new session"
```
/context
```
Gets you oriented in under 30 seconds without manually reading multiple files.

### "Weekly review"
```
/status
```
Gives you a clean pipeline snapshot. Act on any past-due follow-ups it surfaces.

### "I learned something that should affect future sessions"
```
/memory update
```
Describe what changed, and Claude updates the right memory file, commits it, and syncs it.

---

## Notes on Commands

**Commands are in `$APP_DIR/.claude/commands/`** — git-tracked, no PII, available on any machine that clones the repo.

**MCP servers** are not yet configured. If you need structured file search or database queries in the future, see the Phase 2 section of the architecture plan for the `settings.local.template.json` pattern.

**Modifying a command:** Edit the `.md` file in `.claude/commands/`. Changes take effect immediately in the next Claude Code session (no restart needed for file changes).
