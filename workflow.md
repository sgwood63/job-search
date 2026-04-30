# Document Customization Workflow

This workflow ensures you efficiently customize applications while maintaining your authentic voice and avoiding unsupported claims.

## Process Overview

```
JD Provided → AI Evaluation → Profile Match → Auto-Generate Docs → Review → Submit → Track
```

## Job Search Criteria

**Locations accepted:**
- Purely remote positions in the United States
- Hybrid or onsite in the San Francisco Bay Area
- Travel: Less than 25% if travel is required

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
   - Check if remote (US), SF Bay Area hybrid/onsite, or <25% travel
   - If location doesn't match criteria → Update tracker with reason → STOP

3. **Profile matching:**
   - Compare JD against all profiles in the applicant directory
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
     - Pull from `$APPLICANT_DIR/profiles/[profile]-CONTENT.md` content library

5. **Create application folder:**
   - Format: `applications/YYYY-MM-DD-company-role/`
   - Save job description content to `job-description.md`
   - Save extracted key information (company, role, requirements, salary, etc.)
   - Save generated resume and cover letter
   - Create initial notes.md file with JD analysis

6. **Update tracker:**
   - Add to application-tracker.md in the applicant directory
   - Status: "Draft - Ready for Review"
   - Profile used
   - Key match points

### 2. Job Discovery & Initial Assessment (Manual alternative)

**If not using automated process, when you find a position:**

- [ ] Read the full job description
- [ ] Verify location/travel requirements match criteria
- [ ] Identify which job profile(s) it matches (see applicant directory profiles/)
- [ ] Note the company, role title, and key requirements
- [ ] Save job description to a file (for reference during customization)

### 3. Create Application Folder (Manual)

Create the application folder manually:

```
$APPLICANT_DIR/applications/YYYY-MM-DD-company-role/
```

### 4. Analyze Requirements vs. Your Experience (Manual)

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

**Start with your base resume** from the applicant directory base-documents/

**Customization approach:**

1. **Header/Summary**: Adjust 1-2 sentences to align with this role's focus
   - Keep your authentic voice
   - Don't invent experience

2. **Experience bullets**:
   - Reorder to put most relevant first
   - Pull from [templates/](templates/) if you have pre-written bullets
   - Emphasize relevant achievements
   - Use keywords from JD naturally
   - **Voice check**: Read aloud - does it sound like you?

3. **Skills section**:
   - List relevant skills prominently
   - Only include skills you actually have
   - Match terminology from JD where honest

4. **Projects/Portfolio** (if applicable):
   - Highlight relevant work
   - Use terminology that connects to their needs

**Save as**: `$APPLICANT_DIR/applications/[date-company-role]/[FirstName_LastName]_[Role_Title].pdf`

### 6. Customize Cover Letter (Manual)

**Start with your base cover letter** from the applicant directory base-documents/

**Structure:**
```
1. Opening: Why this company/role excites you (authentic enthusiasm)
2. Body 1: Your relevant experience (2-3 key points from requirements mapping)
3. Body 2: What you bring (your unique value, authentically stated)
4. Closing: Forward-looking statement
```

**Guidelines:**
- Use specific examples from your experience
- Reference the company/product/mission authentically
- Keep your conversational voice
- Avoid buzzwords that aren't naturally you
- No claims you couldn't defend in an interview
- Show genuine interest (only apply if you actually have it)

**Save as**: `applications/[date-company-role]/cover-letter-[company]-[role].pdf`

### 7. Voice & Claims Review

**Before submitting, check each document:**

- [ ] **Voice Test**: Read aloud. Does it sound like you talking?
- [ ] **Claims Audit**: Can you provide evidence/examples for every claim?
- [ ] **Comfort Test**: Would you feel confident defending this in an interview?
- [ ] **Consistency Check**: Resume and cover letter tell the same story?
- [ ] **Keyword Balance**: Relevant keywords present but not awkwardly stuffed?

**If anything feels off**: Revise until it feels right. Better to be authentic than perfectly keyword-matched.

### 8. Create Application Notes (if not auto-generated)

In the application folder, create `notes.md`:

```markdown
# [Company] - [Role]

## Application Details
- Date Applied: YYYY-MM-DD
- Source: LinkedIn / Recruiter / Referral
- Job Posting URL: [url]
- Recruiter/Contact: [name if applicable]

## Why This Role
[Your genuine interest - helps with interview prep]

## Key Points Emphasized
- [Bullet 1 from resume/cover letter]
- [Bullet 2]
- [Bullet 3]

## Customizations Made
- Resume: [what you emphasized/reordered]
- Cover Letter: [specific examples or angles you used]

## Follow-up Plan
- [ ] Check application status (date)
- [ ] LinkedIn connection request to recruiter/hiring manager (optional)
- [ ] Follow-up email (date if planned)

## Interview Prep Notes
[Add here if you get an interview]
```

### 9. Submit Application

- [ ] Upload/submit through the appropriate channel
- [ ] Save confirmation email/screenshot
- [ ] Update application-tracker.md in the applicant directory

### 10. Track & Follow-up

**Update the tracker immediately:**
- Application status
- Date submitted
- Next follow-up date

**Set reminders:**
- 1 week: Check status if no response
- 2 weeks: Consider follow-up email
- Update status as you hear back

## Tips for Maintaining Your Voice

### Do:
- Write like you talk (professionally)
- Use specific examples from your actual experience
- Show genuine enthusiasm for things you actually care about
- Be direct and clear
- Use first person ("I led" not "Led")

### Don't:
- Copy buzzwords that aren't naturally you
- Make claims you can't support with examples
- Exaggerate scope or impact of your work
- Use corporate jargon you wouldn't say out loud
- Claim familiarity with tools/methods you've only heard of

## Memory & Rules Sync

Claude maintains a persistent memory system at `~/.claude/projects/.../memory/`. All memory files are mirrored in `memory/` in this repo for version control.

**Rule**: Whenever a memory file is created or updated (feedback rules, user context, experience clarifications), also update the copy in `memory/` and commit to Git.

Files tracked in `memory/`:
- `MEMORY.md` — master index
- `feedback_*.md` — workflow and resume rules

```bash
source "$APP_DIR/.env"
# 1. Edit files in $APP_DIR/memory/
# 2. Commit:
git -C "$APP_DIR" add memory/
git -C "$APP_DIR" commit -m "Update memory: [what changed]"
# 3. Sync to live memory:
CLAUDE_MEM="$HOME/.claude/projects/$(echo "$APP_DIR" | sed 's|/|-|g')/memory/"
cp "$APP_DIR/memory/"*.md "$CLAUDE_MEM"
```

## Efficiency Tips

1. **Build your content library**: As you write strong bullets, add them to `$APPLICANT_DIR/profiles/[profile]-CONTENT.md` for reuse across applications

2. **Profile-based starting points**: Create resume/cover letter variants for each job profile to reduce per-application work

3. **Keywords list**: Maintain a list of your genuine skills/experience with common variations to help match JD language

4. **Batch similar roles**: If applying to multiple similar positions, do them together while in the mindset

5. **Time limit**: Set a max time per application to avoid over-customizing (1-2 hours is usually sufficient)

## Quality over Quantity

**Remember**: One authentic, well-matched application is better than five generic ones. Only apply if:
- The role genuinely interests you
- You can honestly meet most core requirements
- You'd be excited about an interview

This preserves your energy and maintains the quality of your applications.
