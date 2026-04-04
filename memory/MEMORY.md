# Job Search 2026 - Project Memory

## Project Overview
Job search tracking system with profile-based approach for customizing applications.
**Renamed from**: "New project" on 2026-02-16

## Key Files
- `README.md`, `QUICK-START.md`, `workflow.md` - Documentation
- `application-tracker.md` - Master tracker
- `profiles/` - 5 career profiles + PROFILES-QUICK-REFERENCE.md (use for fast matching)
- `applications/` - One folder per application (YYYY-MM-DD-company-role)
- `base-documents/` - Source materials (resumes, LinkedIn, JDs)
- `templates/` - Reusable content library

## Storage Locations
**Primary**: `/Users/shermanwood/Documents/Job-Search-2026/`
**Google Drive**: `/Users/shermanwood/Library/CloudStorage/GoogleDrive-sgwood63@gmail.com/My Drive/Job Search 2026/`
**CRITICAL**: All files must be saved to BOTH locations

## Profiles (5 Total)
1. AI Governance & Risk Lead
2. Analytics Lead (Player-Coach)
3. Enterprise AI Platform Architect
4. Implementation/Customer Success Architect
5. Pre-Sales Solutions Engineer

**Quick Reference**: See `profiles/PROFILES-QUICK-REFERENCE.md` for fast matching
**Full Details**: Individual profile .md files for document generation

## Automated Workflow (DO NOT ASK, JUST DO)

### Use Haiku for Initial Screening (Cost Optimization)
1. User provides JD URL/document
2. **Use Haiku agent** to fetch JD and perform initial evaluation:
   - Extract JD content (company, role, location, travel, requirements, compensation)
   - Check location/travel fit (Remote US, SF Bay hybrid/onsite, <25% travel)
   - Match to best profile using PROFILES-QUICK-REFERENCE.md
   - Determine fit/no-fit with reasoning

### For EVERY JD (fit or no-fit)
3. Create application folder in BOTH locations:
   - Local: `applications/YYYY-MM-DD-company-role/`
   - Google Drive: `Job Search 2026/applications/YYYY-MM-DD-company-role/`
4. Save job-description.md with full JD content and key info

### If NO FIT (stay in Haiku)
5. Create brief notes.md with reasoning
6. Update tracker (Rejected/Closed section)
7. Stop

### If FIT (switch to Sonnet for quality)
5. Read profile-specific content library:
   - `profiles/[profile-name]-CONTENT.md`
   - Pre-compiled content from ALL resumes, organized by profile
   - No need to extract PDFs - content already cached
6. Read full matched profile for strategy/positioning
7. Generate tailored resume using content library (ALL factual, pre-verified)
8. Create detailed notes.md (JD analysis, interview prep)
9. Update tracker (Active Applications)
10. **IMMEDIATELY sync ALL files to Google Drive** (`Job Search 2026/` folder)
11. Present for user review

**CRITICAL**: ALWAYS sync to Google Drive after ANY content generation - never skip this step

**Note**: Profile content libraries eliminate need for per-JD PDF extraction. Content refreshed only when base resumes change.

## Resume Generation Workflow
- See `feedback_resume_review.md` — always assess resume vs JD and apply improvements BEFORE generating the PDF

## Critical Rules: Document Generation

**NEVER fabricate or hallucinate**:
- Do NOT invent companies, titles, achievements, metrics, projects, skills, certifications
- ONLY use information from actual base resume (extract with pdftotext)
- If uncertain, ASK - never guess
- All claims must be supportable with real evidence

**Resume role generation — two specific failure modes to avoid**:
- Content library section headers (e.g. "AI Solution Architect - Presales Experience") are source material labels, NOT job titles. Never render them as job entries.
- Always verify role order against the verified role list in EXPERIENCE-REFERENCE.md before generating. Correct order: LatticeFlow → Drawing Management → Solace → Pyramid → Jaspersoft/TIBCO → Founding Architect (Jaspersoft 2005-2010) → Earlier Career → FS Tech (1985-1999)

**If PDF unreadable**: Ask user for information or alternate format

**Resume optimization (beyond factual accuracy)**:
- Tailor language, emphasis, and framing to the specific role and target company
- Surface the most relevant experience for THIS role — not generic ordering
- Use terminology that mirrors the JD where it truthfully matches experience
- Elevate differentiating content (e.g. domain overlap, startup fit, specific tools mentioned in JD)
- After generating, produce a **detailed evaluation report**: score each JD requirement vs. resume coverage, flag gaps, assess overall effectiveness and competitive positioning

**Resume construction standards** (from base-documents/resume-content-guidance.md):

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

## Experience Clarifications

**See**: `EXPERIENCE-REFERENCE.md` for full details

**Quick Facts**:
- **BI Platforms**: Pyramid, Jaspersoft, TIBCO Spotfire (= Tableau/Power BI equivalents)
- **SQL**: Advanced/expert level - data extraction, transformation, integration, pipelines
- **Sales/BD**: Has experience (proposals, pitches, revenue growth) BUT prefers technical IC roles
- **GenAI**: LatticeFlow AI Risk Management (2023-2025); Julius Baer prospect with FINMA + EU AI Act requirements
- **KYC / Identity Verification**: At LatticeFlow, worked with facial recognition, document validation, and Know Your Customer (KYC) workflows using AI — for banks and identity service vendors. Direct domain match for KYB/KYC/identity verification roles.
- **Integration engineering** (hands-on, across roles): n8n workflow automation (LatticeFlow — AI risk report pipeline via OpenAI GPT); HubSpot (Pyramid — AWS Marketplace → HubSpot integration); Salesforce/SOQL (Jaspersoft — Jasper4Salesforce SaaS BI product on SFDC App Exchange); REST/SOAP connectors (Jaspersoft); SSO/RBAC (Jaspersoft); Talend ETL (Jaspersoft); AWS Marketplace provisioning integration (Pyramid); TIBCO middleware and AWS SNS notification pipelines (Jaspersoft/TIBCO); voice/text/email notification platforms (Jaspersoft/TIBCO, Pyramid Analytics, CRM systems)
- **Apache Kafka**: Solace (2022–2023) — CTO Group Architect at enterprise event streaming company; worked with Kafka architectures and event-driven integration patterns across large enterprise customers
- **JavaScript/TypeScript/Node.js**: Built JS/TS and Node.js systems at Jaspersoft; used JavaScript for front-end integrations
- **Java**: Jaspersoft was a Java house — has Java background from Jaspersoft period (2005–2020), but has not worked in Java since. Foundational familiarity, not current proficiency.
- **Cloud**: AWS (certified), multi-cloud aware
- **Education**: Bachelor's (NOT Master's/PhD - disqualifier for some roles)
- **Financial Services**: Deep FS background — IT at Bank of New Zealand, Midland Montagu, Macquarie Bank (AU, 1985-1996); Morgan Stanley, Thomas Weisel Partners (US, 1997-1999); front/mid/back office systems. See EXPERIENCE-REFERENCE.md for full details.
- **GalenWorks**: Co-founder (not consultant) — hospital analytics startup, 2003–2005. Three founding/early-stage experiences across career: GalenWorks (co-founder 2003–05), Jaspersoft Founding Architect (2005–10), LatticeFlow early hire (2023–25).
- **Encover**: VP IT & Engineering (2010-2012) — sales and marketing SaaS, maintenance contract renewals, call center in Sandy UT. Designed custom CRM — GTM operations from the inside. Relevant for revenue analytics and contact center AI roles.

## Resume Location
- See `feedback_resume_location.md` — always use "San Francisco Bay Area" in resume headers, never "Oakland, CA"

## Workflow Rules
- See `feedback_company_lookup.md` — when user mentions a company, check tracker first; if multiple positions exist, confirm which is relevant (including "new position" option)
- See `feedback_unknown_company_research.md` — for any JD where the end company is not explicitly named, research to identify likely company before or during document generation
- See `feedback_role_ordering.md` — roles must always appear in strict reverse chronological order; never skip a role that falls between two included roles
- See `feedback_jasper4salesforce.md` — Jasper4Salesforce was built 2005–2010 (Founding Architect), NOT during the Director Pre-Sales role (2012–2020); never attribute it to the wrong Jaspersoft role

## User Location & Logistics
- See `user_location.md` — lives in Oakland; Oakland roles are ideal, SF downtown convenient, South Bay is the stretch

## User Preferences
- Remote US, SF Bay Area hybrid/onsite preferred; >25% travel is a CONCERN but not absolute disqualifier
- If travel % not explicitly stated in JD, note as concern but do not assume or disqualify
- Technical IC roles preferred over sales/BD-heavy or management
- Will consider pre-sales/solutions engineering
- Values authentic voice - review all documents before submission
- Organized, systematic tracking approach
- **NO defense/security use cases** - reject roles in defense contracting, military applications, surveillance, or weapons technology
- **Domain preferences**: Housing and healthcare are attractive business domains vs. pure tech/infrastructure roles
- **Real estate / property management**: Has bought and sold multiple Bay Area properties; currently manages a multi-family rental and is actively going through the leasing process. Understands leasing workflows, tenant communication, and property management operations from the operator side — genuine domain credibility for housing/proptech roles
- **NO cover letters** - do not generate cover letters for applications

## Contact Information
**Email**: sgwood63@gmail.com
**LinkedIn**: linkedin.com/in/shermanwood
**Phone**: 415-516-4894
**Work Authorization**: US Citizen

**CRITICAL**: Always use this exact contact information in all generated resumes and cover letters.

## Memory Sync Rule
Memory files are mirrored in `memory/` in the Git repo at `/Users/shermanwood/Documents/Job-Search-2026/` for version control. After creating or updating any memory file, copy it to `memory/` and commit:
```bash
cp ~/.claude/projects/-Users-shermanwood-Documents-Job-Search-2026/memory/*.md \
   /Users/shermanwood/Documents/Job-Search-2026/memory/
git -C /Users/shermanwood/Documents/Job-Search-2026 add memory/
git -C /Users/shermanwood/Documents/Job-Search-2026 commit -m "Update memory: [what changed]"
```

## Cost Optimization Notes
- Use Haiku for JD screening (12x cheaper than Sonnet)
- Use quick-reference profiles for initial matching
- Switch to Sonnet only for document generation
- Reuse resume extraction within session
- Reference external files (EXPERIENCE-REFERENCE.md) instead of duplicating

**Last Updated**: 2026-02-26
