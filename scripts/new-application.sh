#!/bin/bash

# new-application.sh
# Creates a new application folder with template files

set -e

# Load environment variables
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$REPO_ROOT/.env" ]; then
    source "$REPO_ROOT/.env"
else
    echo "Error: $REPO_ROOT/.env not found. Copy .env.example to .env and fill in your paths."
    exit 1
fi

if [ -z "$APPLICANT_DIR" ]; then
    echo "Error: APPLICANT_DIR is not set in .env"
    exit 1
fi

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
APP_FOLDER="${APPLICANT_DIR}/applications/${FOLDER_NAME}"
mkdir -p "$APP_FOLDER"

echo "Created application folder: $APP_FOLDER"

# Create notes.md template
cat > "$APP_FOLDER/notes.md" << EOF
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

## Application Status

- [ ] Resume customized
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
cat > "$APP_FOLDER/job-description.md" << EOF
# ${COMPANY} - ${ROLE}

**Posted**:
**Location**:
**Type**: [Full-time / Contract / etc.]

## Original Job Description

[Paste the full job description here]

## Key Info Extracted

- Company:
- Role:
- Location / Remote:
- Travel:
- Compensation:

## Profile Match

- Best profile:
- Fit score (1-10):
- Key gaps:
EOF

echo ""
echo "Created files:"
echo "  - $APP_FOLDER/notes.md"
echo "  - $APP_FOLDER/job-description.md"
echo ""
echo "Next steps:"
echo "  1. Paste job description into job-description.md"
echo "  2. Generate resume with Claude Code"
echo "  3. Update ${APPLICANT_DIR}/application-tracker.md when submitted"
echo ""
