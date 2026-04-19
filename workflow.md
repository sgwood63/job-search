# Document Customization Workflow

This workflow ensures applications are efficiently customized while maintaining authentic voice and avoiding unsupported claims.

## Process Overview

```
JD Provided → AI Evaluation → Profile Match → Auto-Generate Docs → Review → Submit → Track
```

## Detailed Steps

### 1. Automated JD Analysis & Document Generation

**Provide the job description via:**
- URL to job posting
- Document/PDF with job description
- Copy/paste of job description text

**Claude will automatically:**

1. **Extract key information:**
   - Company name, role title, location, travel requirements
   - Core requirements and responsibilities
   - Nice-to-have qualifications
   - Keywords and themes

2. **Evaluate location/travel fit:**
   - Check criteria from `$APPLICANT_DIR/applicant.md`
   - If no fit → Update tracker with reason → STOP

3. **Profile matching:**
   - Compare JD against all profiles in `$APPLICANT_DIR/profiles/`
   - Identify best-fit profile based on:
     - Technical requirements alignment
     - Role responsibilities match
     - Experience level fit
   - If no good profile match (< 70% fit) → Update tracker with reason → STOP

4. **Generate customized documents:**
   - **Resume**: Using best-fit profile as base
     - Reorder experience bullets for relevance
     - Incorporate JD keywords naturally
     - Emphasize matching achievements
     - Pull from `$APPLICANT_DIR/base-documents/` library
   - **No cover letters** — not used in this search

5. **Create application folder:**
   - Format: `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/`
   - Save job description content to `job-description.md`
   - Save extracted key information (company, role, requirements, salary, etc.)
   - Save generated resume
   - Create initial notes.md file with JD analysis

6. **Update tracker:**
   - Add to `$APPLICANT_DIR/application-tracker.md`
   - Status: "Draft - Ready for Review"
   - Profile used
   - Key match points

### 2. Manual Application Process

**When finding a position manually:**

- [ ] Read the full job description
- [ ] Verify location/travel requirements match criteria (see `$APPLICANT_DIR/applicant.md`)
- [ ] Identify which job profile(s) it matches (see `$APPLICANT_DIR/profiles/`)
- [ ] Note the company, role title, and key requirements

### 3. Create Application Folder (Manual)

```bash
mkdir -p "$APPLICANT_DIR/applications/YYYY-MM-DD-company-role"
```

### 4. Analyze Requirements vs. Experience (Manual)

**Create a requirements mapping document:**

```markdown
## Key Requirements
1. [Requirement from JD] → [Your relevant experience/evidence]
2. [Requirement from JD] → [Your relevant experience/evidence]

## Nice-to-Haves
1. [Requirement] → [Your experience or "Not applicable"]

## Keywords to Include
- [Technical skills, tools, methodologies mentioned in JD]
```

**Rule: If you can't map a requirement to real experience, don't claim it.**

### 5. Customize Resume (Manual)

**Start with the base content** from `$APPLICANT_DIR/base-documents/`

**Customization approach:**

1. **Header/Summary**: Adjust 1-2 sentences to align with this role's focus
2. **Experience bullets**:
   - Reorder to put most relevant first
   - Pull from profile CONTENT.md if available
   - Emphasize relevant achievements
   - Use keywords from JD naturally
3. **Skills section**: List relevant skills; only include skills you actually have

**Save as**: `$APPLICANT_DIR/applications/[date-company-role]/Sherman_Wood_[Role]_[Company].md`

Then generate PDF:
```bash
pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=[app-root]/templates/resume.css
```

### 6. Voice & Claims Review

**Before submitting, check each document:**

- [ ] **Voice Test**: Read aloud. Does it sound authentic?
- [ ] **Claims Audit**: Can you provide evidence/examples for every claim?
- [ ] **Comfort Test**: Would you feel confident defending this in an interview?
- [ ] **Consistency Check**: Resume tells a coherent story?
- [ ] **Keyword Balance**: Relevant keywords present but not awkwardly stuffed?

### 7. Create Application Notes (if not auto-generated)

In the application folder, create `notes.md`:

```markdown
# [Company] - [Role]

## Application Details
- Date Applied: YYYY-MM-DD
- Source: LinkedIn / Recruiter / Referral
- Job Posting URL: [url]
- Recruiter/Contact: [name if applicable]

## Why This Role
[Genuine interest — helps with interview prep]

## Key Points Emphasized
- [Bullet 1]
- [Bullet 2]

## Customizations Made
- Resume: [what you emphasized/reordered]

## Follow-up Plan
- [ ] Check application status (date)
- [ ] Follow-up email (date if planned)

## Interview Prep Notes
[Add here if you get an interview]
```

### 8. Submit Application

- [ ] Upload/submit through the appropriate channel
- [ ] Save confirmation
- [ ] Update `$APPLICANT_DIR/application-tracker.md`

### 9. Track & Follow-up

**Update the tracker immediately:**
- Application status
- Date submitted
- Next follow-up date

---

## Resume Generation

Resumes are authored in Markdown and converted to PDF:

```bash
pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=[app-root]/templates/resume.css
pdfinfo [file].pdf | grep Pages  # verify page count
```

Target: 2 pages for enterprise/direct applications.

---

## Memory & Git

Memory files are written directly by the app — no Claude Code sync needed.

**App-process memory** (git-tracked in `$SOURCE_DIRECTORY/memory/`):
Use the **Commit** button in the Update Memory process after a session, or:
```bash
git -C $SOURCE_DIRECTORY add memory/
git -C $SOURCE_DIRECTORY commit -m "Update memory: [what changed]"
```

**Applicant memory** is saved to `$APPLICANT_DIR/memory/` automatically and is not git-tracked.

---

## Efficiency Tips

1. **Profile content libraries**: Pre-compiled bullets per profile eliminate per-application PDF extraction
2. **PROFILES-QUICK-REFERENCE.md**: Use for fast initial matching when screening a JD
3. **Batch similar roles**: Do multiple similar applications together while in the right mindset
4. **Quality over quantity**: One authentic, well-matched application beats five generic ones

---

## Principles

- **Factual accuracy**: Every claim must be verifiable. Source: `EXPERIENCE-REFERENCE.md`.
- **Authentic voice**: All materials sound like the person, not like an LLM.
- **Profile-based generation**: Resumes generated from pre-compiled content libraries, not improvised.
- **No cover letters**: Not used in this search.
- **Organized tracking**: One tracker, updated immediately after every status change.
