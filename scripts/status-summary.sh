#!/bin/bash

# status-summary.sh
# Generates a quick summary of your job search status

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

APPLICATIONS_DIR="${APPLICANT_DIR}/applications"
PROFILES_DIR="${APPLICANT_DIR}/profiles"
BASE_DOCS_DIR="${APPLICANT_DIR}/base-documents"

echo "=== Job Search Status Summary ==="
echo ""
echo "Generated: $(date '+%Y-%m-%d %H:%M')"
echo ""

# Count applications
APP_COUNT=$(find "$APPLICATIONS_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
echo "Total applications: $APP_COUNT"

# Recent applications (last 7 days)
WEEK_AGO=$(date -v-7d '+%Y-%m-%d' 2>/dev/null || date -d '7 days ago' '+%Y-%m-%d' 2>/dev/null || echo "1970-01-01")

echo ""
echo "=== Recent Applications ==="
echo ""

# List 5 most recent applications
find "$APPLICATIONS_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -r | head -5 | while read -r dir; do
    FOLDER_NAME=$(basename "$dir")
    APP_DATE=$(echo "$FOLDER_NAME" | cut -d'-' -f1-3)
    DETAILS=$(echo "$FOLDER_NAME" | cut -d'-' -f4- | tr '-' ' ')

    if [ -f "$dir/notes.md" ]; then
        STATUS=$(grep "^\*\*Status\*\*:" "$dir/notes.md" 2>/dev/null | cut -d':' -f2 | tr -d ' ')
        [ -z "$STATUS" ] && STATUS="Unknown"
    else
        STATUS="Unknown"
    fi

    echo "  $APP_DATE - $DETAILS [$STATUS]"
done

echo ""
echo "=== Action Items ==="
echo ""

echo "Applications needing follow-up:"
find "$APPLICATIONS_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r dir; do
    if [ -f "$dir/notes.md" ]; then
        FOLDER_NAME=$(basename "$dir")
        APP_DATE=$(echo "$FOLDER_NAME" | cut -d'-' -f1-3)

        STATUS=$(grep "^\*\*Status\*\*:" "$dir/notes.md" 2>/dev/null | cut -d':' -f2 | tr -d ' ')

        if [ "$STATUS" = "Applied" ]; then
            if [[ "$APP_DATE" < "$WEEK_AGO" ]]; then
                DETAILS=$(echo "$FOLDER_NAME" | cut -d'-' -f4- | tr '-' ' ')
                echo "  $APP_DATE - $DETAILS (no response yet)"
            fi
        fi
    fi
done

echo ""
echo "=== Quick Stats ==="
echo ""

BASE_DOCS=$(find "$BASE_DOCS_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "Base documents: $BASE_DOCS"

PROFILES=$(find "$PROFILES_DIR" -type f -name "*.md" ! -name "README.md" ! -name "TEMPLATE.md" ! -name "PROFILES-QUICK-REFERENCE.md" 2>/dev/null | wc -l | tr -d ' ')
echo "Job profiles defined: $PROFILES"

echo ""
echo "For detailed tracking, see: ${APPLICANT_DIR}/application-tracker.md"
echo ""
