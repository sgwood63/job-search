# Claude Code — Job Search 2026

This file is auto-loaded at session start. It contains core context and workflow triggers. Detailed steps live in `workflow.md` (JD processing, resume pipeline) and `applicant-setup.md` (onboarding phases).

## Directory Paths

Canonical paths are defined in `$APP_DIR/.env` (gitignored). Read that file at session start to resolve path variables. If `.env` is not present, ask the user to run `bash scripts/setup.sh`.

| Variable | Defined in `.env` | Notes |
|---|---|---|
| `$APP_DIR` | Yes | Process repo, git-tracked |
| `$APPLICANT_DIR` | Yes | Applicant data, NOT git-tracked |

Applicant-specific context (identity, location, experience, job criteria) is in `$APPLICANT_DIR/applicant.md`.

## APP_DIR File Authoring Rules

Every `.md` file in `$APP_DIR` must use "the applicant" or "the user" (never the applicant's name) and must never contain hard-coded absolute paths. A pre-commit hook (`scripts/check-md-hygiene.sh`) enforces both rules at commit time.

## New Applicant Setup — DO NOT ASK, JUST DO

When the user says "start setup", "set up applicant", or expresses clear intent to begin onboarding:

1. Verify `.env` is loaded and `$APPLICANT_DIR` exists — if not, tell user to run `bash scripts/setup.sh`
2. Read `$APP_DIR/applicant-setup.md` and execute phases A–E in order, pausing between each for confirmation
3. Use **Sonnet** throughout — setup is generative work, not screening

## Automated Workflow — DO NOT ASK, JUST DO

When the user provides a job description (URL, document, or paste), execute immediately. See `workflow.md` for full detail.

**Fetch:** Try WebFetch first. On login wall or failure, fall back to `"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" "<url>"`. Exit code 2 = auth required — show user the stderr setup command; exit code 1 = ask user to paste.

**Screen (Haiku):** Spawn a Haiku agent to extract company/role/location/travel/comp, check fit against `$APPLICANT_DIR/applicant.md`, and match to best profile using `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`.

**Folder (every JD, fit or no-fit):** `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/` with `job-description.md` and original JD file (`jd-<company>-<role>.[ext]`).

**No fit:** Brief `notes.md`, tracker update (Rejected section), stop.

**Fit:** Switch to Sonnet. Read matched profile files. Generate resume, create detailed `notes.md`, update tracker (Active section).

## Profile Maintenance — DO NOT ASK, JUST DO

When the user provides new experience, achievements, preference changes, or career direction updates, execute immediately. See `applicant-setup.md` Phase F for the full classification matrix, file rules, and logging instructions.

**Key rules:**
- Consult the File Registry in `applicant-setup.md` Phase F — reason from what changed against each file's role to determine what needs updating
- Append a session entry to `$APPLICANT_DIR/applicant-maintenance.md`
- Update `career-advice.md` Feedback Incorporated only when the change directly affects the advice
- Do not update `APPLICANT-MEMORY.md` for maintenance changes

## Critical Rules

**No fabrication.** Source only from `$APPLICANT_DIR/profiles/[profile]-CONTENT.md` and `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`. Never invent companies, titles, achievements, metrics, projects, skills, or certifications. If uncertain, ask.

**No unverified percentage metrics.** Verified, sourced percentages are allowed. Unverified/estimated X% claims must use qualitative language instead ("substantially improved", "significantly reduced"). Counts and named outputs are always fine (50+ engagements, 400+ customers).

**Domain connection.** For every application: identify the target company's business domain and surface the applicant's connections in `notes.md` (Fit Assessment → Domain Connection subsection) and in resume bullets. Check all four sources: (1) professional roles; (2) personal/life experience (cover letter only, not bullets); (3) specific artifacts built — demos, reference implementations, POCs in the domain; (4) use-case connections — adjacent industry or process exposure that maps to what the company's product does. See `memory/feedback_domain_connection.md`.

**Review before PDF.** Write `.md` → assess vs. JD → edit → generate PDF → verify page count. Never skip. See `workflow.md` for PDF command.

## Resume Generation

**Length:** 2 pages for enterprise/consulting/governance roles; 1 page for networking, warm referrals, recruiter outreach, pre-sales SE, pivots.

**After generating:** Produce a detailed evaluation report scoring each JD requirement vs. resume coverage, flagging gaps and competitive positioning.

See `workflow.md` for: notes.md structure, PDF command, file naming, section labels, earlier career rules, evaluation report format.
See `memory/` feedback files (indexed in MEMORY.md) for: bullet formula, role ordering, education/certs, signal density, no-duplication rules.

## Profiles Directory

`$APPLICANT_DIR/profiles/` is the working source of truth. `base-documents/` is setup-only — do not read it during normal workflow. See `templates/PROFILES-README.md` for authoring guidance.

## File Storage

`$APPLICANT_DIR` is set during setup to a local directory or a cloud sync service's managed local folder. The OS syncs automatically — no separate step needed.

## Workflow Rules

**Company lookup:** Check `$APPLICANT_DIR/application-tracker.md` before acting on any company mention. Multiple entries → confirm which is relevant (include "new position" as an option). See `memory/feedback_company_lookup.md`.

**Unknown company:** For unnamed JDs (recruiter postings, confidential), research the end company before generating documents. See `memory/feedback_unknown_company_research.md`.

## Session Strategy

Short, task-scoped sessions (one application, one interview prep, one memory update). Long sessions degrade through context compression.

**Session end — do without being asked:**
1. Update `$APPLICANT_DIR/memory/applicant-setup-status.md` with current search state
2. Ensure `$APP_DIR/.claude/settings.json` statusLine reflects current phase

## Cost Optimization

- **Haiku** for JD screening (12× cheaper than Sonnet)
- **Sonnet** for document generation only
- Reuse resume content within a session; do not re-extract from PDFs

## Memory Sync Rule

`$APP_DIR/memory/` is the source of truth. After editing memory files:

```bash
source "$APP_DIR/.env"
git -C "$APP_DIR" add memory/
git -C "$APP_DIR" commit -m "Update memory: [what changed]"
CLAUDE_MEM="$HOME/.claude/projects/$(echo "$APP_DIR" | sed 's|/|-|g')/memory/"
cp "$APP_DIR/memory/"*.md "$CLAUDE_MEM"
```

Applicant-specific memory lives in `$APPLICANT_DIR/memory/` and is managed separately.
