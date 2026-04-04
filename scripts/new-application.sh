#!/bin/bash

# new-application.sh
# Creates a new application folder with template files

set -e

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: ./new-application.sh \"Company Name\" \"Role Title\" [profile]"
    echo "Example: ./new-application.sh \"Acme Corp\" \"Senior Product Manager\" \"product-manager-b2b\""
    exit 1
fi

COMPANY="$1"
ROLE="$2"
PROFILE="${3:-unspecified}"

# Get current date
DATE=$(date +%Y-%m-%d)

# Create safe folder name (lowercase, replace spaces with hyphens)
COMPANY_SLUG=$(echo "$COMPANY" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
ROLE_SLUG=$(echo "$ROLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
FOLDER_NAME="${DATE}-${COMPANY_SLUG}-${ROLE_SLUG}"

# Create application directory
APP_DIR="applications/${FOLDER_NAME}"
mkdir -p "$APP_DIR"

echo "Created application folder: $APP_DIR"

# Create notes.md template
cat > "$APP_DIR/notes.md" << EOF
# ${COMPANY} - ${ROLE}

## Application Details
- Date Applied: ${DATE}
- Source: [LinkedIn / Recruiter / Referral]
- Job Posting URL:
- Recruiter/Contact:
- Profile Match: ${PROFILE}

## Why This Role
[Your genuine interest - helps with interview prep]

## Key Requirements Analysis

### Must-Haves
1. [Requirement from JD] → [Your relevant experience]
2.
3.

### Nice-to-Haves
1. [Requirement] → [Your experience or "Not applicable"]
2.

### Keywords to Emphasize
-
-

## Customizations Made

### Resume
- Lead with:
- Emphasized:
- Keywords used:

### Cover Letter
- Opening angle:
- Key stories/examples used:
  1.
  2.

## Application Status

- [ ] Resume customized
- [ ] Cover letter written
- [ ] Application submitted
- [ ] Confirmation received
- [ ] Tracker updated

## Follow-up Plan
- [ ] Check application status (1 week): ${DATE}
- [ ] Follow-up email (2 weeks if no response)
- [ ] LinkedIn connection to recruiter (optional)

## Interview Prep Notes
[Add here if you get an interview]

### Questions They Might Ask
-
-

### Questions to Ask Them
-
-

### Key Stories to Prepare
-
-

## Correspondence Log

### ${DATE} - Application Submitted
- Method: [LinkedIn / Company site / Email]
- Confirmation: [Yes/No]

---

**Status**: Applied
**Last Updated**: ${DATE}
EOF

# Create job-description.md placeholder
cat > "$APP_DIR/job-description.md" << EOF
# ${COMPANY} - ${ROLE}

**Posted**:
**Location**:
**Type**: [Full-time / Contract / etc.]

## Original Job Description

[Paste the full job description here]

## Quick Analysis

**Match Score**: [1-10]
**Red Flags**: [Any concerns]
**Excitement Level**: [1-10]

## Key Takeaways
-
-
EOF

# Create checklist.md
cat > "$APP_DIR/checklist.md" << EOF
# Application Checklist: ${COMPANY}

## Pre-Application
- [ ] Read full job description
- [ ] Research company (website, news, LinkedIn)
- [ ] Identify matching profile: ${PROFILE}
- [ ] Map requirements to your experience
- [ ] Confirm you genuinely want this role

## Document Preparation
- [ ] Copy base resume to this folder
- [ ] Customize resume for this role
- [ ] Review relevant templates
- [ ] Write/customize cover letter
- [ ] Voice check (read both aloud)
- [ ] Claims audit (can defend everything?)

## Submission
- [ ] Save final PDFs with proper naming
- [ ] Submit application
- [ ] Save confirmation
- [ ] Update application-tracker.md
- [ ] Set follow-up reminder

## Quality Gates
- [ ] Resume sounds like me
- [ ] Cover letter shows genuine interest
- [ ] No unsupported claims
- [ ] Keywords naturally included
- [ ] Error-free (grammar, spelling, formatting)
EOF

echo ""
echo "Created files:"
echo "  - notes.md (main tracking document)"
echo "  - job-description.md (paste JD here)"
echo "  - checklist.md (step-by-step guide)"
echo ""
echo "Next steps:"
echo "  1. cd $APP_DIR"
echo "  2. Paste job description into job-description.md"
echo "  3. Follow checklist.md for the application process"
echo "  4. Copy and customize your resume and cover letter"
echo ""
echo "Don't forget to update application-tracker.md when done!"
