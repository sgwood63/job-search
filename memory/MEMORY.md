---
name: Job Search 2026 - App Process Memory
description: Master index of app-process rules and workflow guidance (app source tree, git-tracked)
type: project
---

# Job Search 2026 — App Process Memory

**Applicant-specific context** (contact info, experience facts, personal preferences) lives at:
`$APPLICANT_DIR/memory/APPLICANT-MEMORY.md` and `$APPLICANT_DIR/applicant.md`

This file contains only process rules and app configuration guidance.

---

## Automated Workflow (DO NOT ASK, JUST DO)

### Use Haiku for Initial Screening (Cost Optimization)
1. User provides JD URL/document
2. **Use Haiku agent** to fetch JD and perform initial evaluation:
   - Extract JD content (company, role, location, travel, requirements, compensation)
   - Check location/travel fit (criteria in `$APPLICANT_DIR/applicant.md`)
   - Match to best profile using PROFILES-QUICK-REFERENCE.md
   - Determine fit/no-fit with reasoning

### For EVERY JD (fit or no-fit)
3. Create application folder in BOTH locations:
   - Local: `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/`
   - Google Drive: `$gdrive_root/applications/YYYY-MM-DD-company-role/`
4. Save job-description.md with full JD content and key info

### If NO FIT (stay in Haiku)
5. Create brief notes.md with reasoning
6. Update tracker (Rejected/Closed section)
7. Stop

### If FIT (switch to Sonnet for quality)
5. Read profile-specific content library:
   - `$APPLICANT_DIR/profiles/[profile-name]-CONTENT.md`
   - Pre-compiled content from ALL resumes, organized by profile
   - No need to extract PDFs — content already cached
6. Read full matched profile for strategy/positioning
7. Generate tailored resume using content library (ALL factual, pre-verified)
8. Create detailed notes.md (JD analysis, interview prep)
9. Update tracker (Active Applications)
10. **IMMEDIATELY sync ALL files to Google Drive**
11. Present for user review

**CRITICAL**: ALWAYS sync to Google Drive after ANY content generation — never skip this step

---

## Resume Generation Workflow
- See `feedback_resume_review.md` — always assess resume vs JD and apply improvements BEFORE generating the PDF

## Critical Rules: Document Generation

**NEVER fabricate or hallucinate**:
- Do NOT invent companies, titles, achievements, metrics, projects, skills, certifications
- ONLY use information from actual base resume / `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md`
- If uncertain, ASK — never guess
- All claims must be supportable with real evidence

**Resume role generation — two specific failure modes to avoid**:
- Content library section headers (e.g. "AI Solution Architect - Presales Experience") are source material labels, NOT job titles. Never render them as job entries.
- Always verify role order against the verified role list in EXPERIENCE-REFERENCE.md before generating.

**If PDF unreadable**: Ask user for information or alternate format

**Resume optimization (beyond factual accuracy)**:
- Tailor language, emphasis, and framing to the specific role and target company
- Surface the most relevant experience for THIS role — not generic ordering
- Use terminology that mirrors the JD where it truthfully matches experience
- Elevate differentiating content (e.g. domain overlap, startup fit, specific tools mentioned in JD)
- After generating, produce a **detailed evaluation report**: score each JD requirement vs. resume coverage, flag gaps, assess overall effectiveness and competitive positioning

**Resume construction standards** (from `$APPLICANT_DIR/base-documents/resume-content-guidance.md`):

*Length*:
- **2 pages default** for enterprise/consulting/governance/direct applications
- **1 page** for: networking, warm referrals, recruiter outreach, pre-sales SE roles, role pivoting

*Detail per role*:
- Recent roles (last 10–12 years): **5–7 bullets**
- Mid-career (12–20 years ago): **2–4 bullets**
- Early career (20+ years): **1 bullet or title only**

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

---

## Workflow Rules
- See `feedback_company_lookup.md` — when user mentions a company, check tracker first; if multiple positions exist, confirm which is relevant (including "new position" option)
- See `feedback_unknown_company_research.md` — for any JD where the end company is not explicitly named, research to identify likely company before or during document generation
- See `feedback_role_ordering.md` — roles must always appear in strict reverse chronological order; never skip a role that falls between two included roles

---

## App Development
- [Job Search App](project_job_search_app.md) — Streamlit + Anthropic API app at `$SOURCE_DIRECTORY/app/`

## Session Strategy
- [Session Strategy](feedback_session_strategy.md) — use short task-scoped sessions; memory carries context across sessions

## Cost Optimization Notes
- Use Haiku for JD screening (12x cheaper than Sonnet)
- Use quick-reference profiles for initial matching
- Switch to Sonnet only for document generation

---

**Last Updated**: 2026-04-19
