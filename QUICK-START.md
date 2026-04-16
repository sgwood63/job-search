# Quick Start — Setting Up the Job Search Assistant

This guide covers how to bootstrap this system from scratch. If the system is already running, skip to **Applying to a Role**.

---

## Phase 1: Foundation (One-time setup)

### 1. Set the APPLICANT_DIR environment variable

All applicant data lives outside the app source tree in a directory you control:

```bash
# In app/.env:
APPLICANT_DIR=/path/to/your/applicant/data
```

The directory must contain:
```
$APPLICANT_DIR/
├── applicant.md                  # contact info, criteria, preferences
├── application-tracker.md        # master tracker
├── profiles/                     # career profiles
├── applications/                 # one folder per application
├── base-documents/               # EXPERIENCE-REFERENCE.md and source docs
└── memory/                       # applicant-specific memory files
    └── APPLICANT-MEMORY.md       # index
```

### 2. Establish your experience baseline

Create `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md` — the canonical, verified source of every claim you will make in any resume.

Include for each role:
- Exact title, company, dates
- What the company did (one sentence)
- What you specifically did — your actual contributions, not generic job duties
- Technologies, platforms, tools you genuinely used
- Any public credentials (repos, publications, certifications)

**Rule**: If you're not certain a claim is accurate, mark it as unverified and clarify before using it. This file is the ground truth. Resumes are generated from it — not the other way around.

### 3. Create applicant.md

Create `$APPLICANT_DIR/applicant.md` with:
- Contact information (name, email, phone, LinkedIn, GitHub)
- Location preferences and commute constraints
- Job search criteria (remote/hybrid, travel %, domains of interest)
- Hard rules (e.g., no defense roles, no cover letters)
- Preferred role types (IC vs. management)

### 4. Define job profiles

Identify 2–5 types of roles you're targeting. For each, create:

**`$APPLICANT_DIR/profiles/[profile-name].md`** — Strategy document:
- What makes you strong for this type of role
- How to frame your experience for this audience
- What to emphasize, what to compress

**`$APPLICANT_DIR/profiles/[profile-name]-CONTENT.md`** — Pre-compiled content library:
- Resume bullets organized by role, ready to pull from
- Eliminates re-extraction from PDFs for every application

**`$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md`** — One-page matching guide:
- Summary of each profile with key signals
- Used for fast initial matching when screening a JD

### 5. Set up resume generation

Install PDF generation dependencies:
```bash
pip install weasyprint
brew install pandoc
```

Verify `templates/resume.css` is present in the app source tree — this is the shared stylesheet.

Test with any `.md` file:
```bash
pandoc test.md -o test.pdf --pdf-engine=weasyprint --css=templates/resume.css
pdfinfo test.pdf | grep Pages
```

### 6. Configure storage

This system writes to two locations — keep both in sync after every file generation:

- **Local (APPLICANT_DIR)**: configured in `app/.env`
- **Google Drive**: configured in `app/config.yaml` under `applicant.gdrive_root`

### 7. Initialize the tracker

Create `$APPLICANT_DIR/application-tracker.md`:

```markdown
# Job Application Tracker

## Active Applications
| Date | Company | Role | Profile | Source | Status | Next Action | Priority |
|------|---------|------|---------|--------|--------|-------------|----------|

## Closed / Rejected
| Date | Company | Role | Outcome | Notes |
|------|---------|------|---------|-------|
```

### 8. Run the app

```bash
cd app/
pip install -r requirements.txt
cp .env.example .env         # add API key and APPLICANT_DIR
streamlit run app.py
```

---

## Phase 2: Applying to a Role

### When you find a job to apply for:

**Step 1 — Screen the JD**

Provide the JD (URL, PDF, or paste). The AI evaluates:
- Location/travel fit (criteria from `$APPLICANT_DIR/applicant.md`)
- Profile match (best fit from your profiles)
- Overall fit score and gaps

Creates:
- `$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/job-description.md`
- Initial `notes.md` with JD analysis and coverage table
- Tracker entry with status and next action

If no fit: tracker entry with reason. Stop.

**Step 2 — Generate resume**

With the application folder and matched profile identified:
- Load the profile's CONTENT.md library
- Load EXPERIENCE-REFERENCE.md
- Generate tailored resume in Markdown
- Review against JD before generating PDF

```bash
pandoc [resume].md -o [resume].pdf --pdf-engine=weasyprint --css=[app-root]/templates/resume.css
pdfinfo [resume].pdf | grep Pages  # verify 2 pages
```

**Step 3 — Review**

Before submitting:
- Does every bullet have a factual basis in EXPERIENCE-REFERENCE.md?
- Does it read authentically?
- Does it answer: fit, credibility, environment match?

**Step 4 — Submit and track**

After submitting:
- Update `notes.md` with submission date and follow-up date
- Update `application-tracker.md` status to Applied
- Sync both files to Google Drive

---

## Phase 3: Interview Process

### Recruiter / hiring manager call

After each call, update `notes.md`:
- Who you spoke with, their role
- What they said about the process and timeline
- Any signals about what matters to them

### Interview prep

Generate prep notes in `notes.md`:
- Likely questions based on role and JD
- Key talking points per question
- Specifics to bring up (projects, metrics, examples)

### Debrief

After each interview:
- What went well / what to improve
- What they emphasized — use for next round prep

---

## Daily / Weekly Habits

**When something changes** (offer, rejection, interview scheduled):
- Update `application-tracker.md` immediately
- Update the application's `notes.md`
- Sync both to Google Drive

**Weekly (15 min)**:
- Review tracker for pending follow-ups
- Any applications past follow-up date? Send a note.

**When you learn something new about your experience**:
- Update `$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md` first
- Then update the relevant `profiles/[profile]-CONTENT.md`
- Memory sync if it's a rule or preference (see workflow.md)
