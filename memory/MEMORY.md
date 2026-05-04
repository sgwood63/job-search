# Job Search 2026 - Process Memory

## Process Overview
Job application workflow using profile-based resume customization, Claude Code processes, and structured tracking.

## Key Files
- `README.md`, `QUICK-START.md`, `workflow.md` - Documentation
- `templates/` - CSS and reusable content library
- `scripts/` - Helper utilities
- See [reference_directories.md](reference_directories.md) — **canonical path definitions** (`$APP_DIR`, `$APPLICANT_DIR`)

## Applicant Context
Applicant-specific context (identity, location, experience, role rules) lives in the applicant directory — not here.
Index: `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md`

## Automated Workflow (DO NOT ASK, JUST DO)

### Use Haiku for Initial Screening (Cost Optimization)
1. User provides JD URL/document
2. **Use Haiku agent** to fetch JD and perform initial evaluation:
   - Extract JD content (company, role, location, travel, requirements, compensation)
   - Check location/travel fit per applicant's criteria (`$APPLICANT_DIR/applicant.md`)
   - Match to best profile using `$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`
   - Determine fit/no-fit with reasoning

### For EVERY JD (fit or no-fit)
3. Create application folder in `$APPLICANT_DIR/applications/`
4. Save job-description.md with full JD content and key info
5. Save original JD content to a separate file named `jd-<company>-<role-title>.[ext]` (lowercase, hyphens):
   - URL source → `jd-<company>-<role-title>.md` (full page text via `fetch-jd.py --md-out`)
   - PDF source → `jd-<company>-<role-title>.pdf` (copy of original file)
   - Pasted text → `jd-<company>-<role-title>.md` (verbatim)
   - Auth files for login-walled sites live in `$APPLICANT_DIR/.auth/` — set up once per domain with `fetch-jd.py --setup <url>` (opens default browser, scans Firefox, falls back to manual DevTools entry); re-run `--setup` or `--import <domain>` when exit code 2 is returned
6. In notes.md JD Analysis section: record the full source URL and the original filename saved

### If NO FIT (stay in Haiku)
7. Create brief notes.md with reasoning
8. Update tracker (Rejected/Closed section)
9. Stop

### If FIT (switch to Sonnet for quality)
7. Read profile-specific content library from `$APPLICANT_DIR/profiles/`
8. Read full matched profile for strategy/positioning
9. Generate tailored resume using content library (ALL factual, pre-verified)
10. Create detailed notes.md (JD analysis, interview prep)
11. Update tracker (Active Applications)
12. Present for user review

## Resume Generation Workflow
- See `feedback_resume_review.md` — always assess resume vs JD before PDF; no percentage metrics in bullets; correct file naming

## Critical Rules: Document Generation

**NEVER fabricate or hallucinate**:
- Do NOT invent companies, titles, achievements, metrics, projects, skills, certifications
- ONLY use information from `$APPLICANT_DIR/profiles/[profile]-CONTENT.md` and `$APPLICANT_DIR/profiles/EXPERIENCE-REFERENCE.md`
- If uncertain about a fact, ASK — never guess
- All claims must be supportable with real evidence

**Resume role generation — two specific failure modes to avoid**:
- Content library section headers (e.g. "AI Solution Architect - Presales Experience") are source material labels, NOT job titles. Never render them as job entries.
- Always verify role order against the verified role list in applicant's EXPERIENCE-REFERENCE.md before generating

**If PDF unreadable**: Ask user for information or alternate format

**Resume optimization (beyond factual accuracy)**:
- Tailor language, emphasis, and framing to the specific role and target company
- Surface the most relevant experience for THIS role — not generic ordering
- Use terminology that mirrors the JD where it truthfully matches experience
- Elevate differentiating content (e.g. domain overlap, startup fit, specific tools mentioned in JD)
- After generating, produce a **detailed evaluation report**: score each JD requirement vs. resume coverage, flag gaps, assess overall effectiveness and competitive positioning

**Resume construction standards**:

*Length*:
- **2 pages default** for enterprise/consulting/governance/direct applications
- **1 page** for: networking, warm referrals, recruiter outreach, pre-sales SE roles, role pivoting

*Detail per role*:
- Recent roles (last 10–12 years): **5–7 bullets**
- Mid-career (12–20 years ago): **2–4 bullets**
- Early career (20+ years): **1 bullet or title only**

*Section labels*:
- Experience section must be labeled **`## RELEVANT EXPERIENCE`** (all caps) — never "Experience" or "Professional Experience"
- Roles that ended more than 12 years ago must be compressed into a single **"Earlier Career"** section, not individual role sections

*No duplication*:
- Capabilities section items must not overlap — merge any that cover the same domain
- Each achievement must appear in the role period where it actually occurred — never attribute work from one era to another role's section

*Signal density*:
- Every bullet answers a recruiter question: "Can they talk to customers? Design architectures? Make AI/analytics work?"
- Bullet formula: **Action → Technical Domain → Context → Outcome**
- Use hands-on IC verbs: designed, implemented, architected, built, delivered
- Avoid management language (led large teams, departmental strategy, oversaw transformation)
- Use **technology categories** in capabilities section, not exhaustive tool lists — specific tools go inside role bullets for context
- Write natural sentences with embedded keywords — not ATS keyword stuffing

*Common mistakes to avoid*:
- Opening with career history ("25 years of experience...") — lead with current positioning instead
- Equal detail on old and recent roles — compress everything 12+ years old
- Hiding customer-facing experience — explicitly mention discovery, demos, POCs, architecture discussions
- Management framing when targeting IC roles — signal technical leadership, not org leadership

*The 3 questions the resume must answer quickly*:
1. Does this person fit the role?
2. Do they have credible experience?
3. Can they succeed in our environment?

## Session Start (DO WITHOUT BEING ASKED)
At the start of every session, automatically run the `/context` workflow before responding: read `.env`, `applicant.md`, `application-tracker.md`, `APPLICANT-MEMORY.md`, and `MEMORY.md`, then output a 10-line session briefing ending with "Context loaded. Ready." Skip if the user's first message makes clear context is already loaded.

## Applicant Memory — Update in Real-Time (DO WITHOUT BEING ASKED)
When the user states a clear preference, fact, constraint, or rule about themselves, immediately update the relevant file in `$APPLICANT_DIR/memory/`. No sync step needed — `$APPLICANT_DIR` is plain local storage.

## Session End (DO WITHOUT BEING ASKED)
- See `feedback_session_end.md` — always update `$APPLICANT_DIR/memory/applicant-setup-status.md` and ensure `.claude/settings.json` statusLine is current before ending any session
- `$APP_DIR/memory/` sync is now automatic (Stop hook runs `scripts/sync-memory.sh` after every response) — no manual git step needed

## Profiles Directory — Source of Truth
- See [project_profiles_directory.md](project_profiles_directory.md) — `profiles/` contains EXPERIENCE-REFERENCE.md and role-achievements.md; `base-documents/` is setup-only

## Profile Maintenance (DO NOT ASK, JUST DO)
- See `applicant-setup.md` Phase F — trigger phrases, File Registry, Cross-Profile Propagation Rule, and logging instructions
- After every maintenance session: append entry to `$APPLICANT_DIR/applicant-maintenance.md`
- Update `career-advice.md` Feedback Incorporated only when the change directly affects the advice

## Workflow Rules
- See `feedback_application_status_update.md` — when user confirms they applied, update both tracker AND notes.md (status field + process reminder section)
- See `feedback_company_lookup.md` — when user mentions a company, check tracker first; if multiple positions exist, confirm which is relevant (including "new position" option)
- See `feedback_unknown_company_research.md` — for any JD where the end company is not explicitly named, research to identify likely company before or during document generation
- See `feedback_role_ordering.md` — roles must always appear in strict reverse chronological order; never skip a role that falls between two included roles
- See `feedback_domain_connection.md` — always identify and surface the applicant's connection to the target company's *business domain* (not just the role) in each resume; domain connections often live in Earlier Career and need explicit callout in bullets
- See `feedback_jd_file_saving.md` — verbatim raw text in `jd-*.md`, structured summary in `job-description.md`; both required for every application before resume generation
- See `feedback_resume_education_certs.md` — every resume must include Education and Certifications sections at the bottom, copied verbatim from EXPERIENCE-REFERENCE.md
- See `feedback_session_strategy.md` — use short, task-scoped sessions; long sessions degrade through context compression
- See `feedback_doc_maintenance.md` — after editing any $APP_DIR source file, use the lookup table to identify which human-facing docs reference the changed area and update only those passages
- See `feedback_profile_maintenance.md` — when adding a new achievement or creating a new profile, run the explicit 4-step or 6-step checklist; do not rely on registry reasoning alone for these two operations
- See `feedback_dev_mode.md` — never auto-toggle DEV_MODE; always prompt user to enable/disable manually and wait
- See `feedback_commits.md` — multi-file changes must be committed together; commit all APP_DIR files manually before response ends to prevent Stop hook splitting the commit

## Memory Sync Rule
`$APP_DIR/memory/` is the source of truth. After every Claude response, `scripts/sync-memory.sh` runs automatically via a Stop hook: commits any uncommitted changes in `memory/` and copies them to `~/.claude/projects/.../memory/`. No manual step needed during sessions.

To sync manually (e.g., after editing outside a session):
```bash
bash "$APP_DIR/scripts/sync-memory.sh"
```
Applicant-specific memory lives in `$APPLICANT_DIR/memory/` and is updated in real-time during sessions — no sync step needed.

## Cost Optimization Notes
- Use Haiku for JD screening (12x cheaper than Sonnet)
- Use quick-reference profiles for initial matching
- Switch to Sonnet only for document generation
- Content is pre-compiled in `$APPLICANT_DIR/profiles/[profile]-CONTENT.md` — no per-session extraction needed

**Last Updated**: 2026-05-03

---

*Note: Applicant-specific session state (setup completion, active profiles, unverified items) lives in `$APPLICANT_DIR/memory/`. Read `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md` at session start for current applicant context.*
