#!/bin/bash

# status-summary.sh
# Generates a quick summary of your job search status

echo "=== Job Search Status Summary ==="
echo ""
echo "Generated: $(date '+%Y-%m-%d %H:%M')"
echo ""

# Count applications
APP_COUNT=$(find applications -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
echo "📁 Total applications: $APP_COUNT"

# Recent applications (last 7 days)
WEEK_AGO=$(date -v-7d '+%Y-%m-%d' 2>/dev/null || date -d '7 days ago' '+%Y-%m-%d' 2>/dev/null || echo "1970-01-01")
RECENT_COUNT=$(find applications -mindepth 1 -maxdepth 1 -type d -name "${WEEK_AGO}*" 2>/dev/null | wc -l | tr -d ' ')
echo "📅 Applications this week: $RECENT_COUNT"

echo ""
echo "=== Recent Applications ==="
echo ""

# List 5 most recent applications
find applications -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -r | head -5 | while read -r dir; do
    FOLDER_NAME=$(basename "$dir")
    # Extract date from folder name (format: YYYY-MM-DD-company-role)
    APP_DATE=$(echo "$FOLDER_NAME" | cut -d'-' -f1-3)
    DETAILS=$(echo "$FOLDER_NAME" | cut -d'-' -f4- | tr '-' ' ')

    if [ -f "$dir/notes.md" ]; then
        # Try to extract status from notes
        STATUS=$(grep "^**Status**:" "$dir/notes.md" 2>/dev/null | cut -d':' -f2 | tr -d ' ')
        [ -z "$STATUS" ] && STATUS="Unknown"
    else
        STATUS="Unknown"
    fi

    echo "  $APP_DATE - $DETAILS [$STATUS]"
done

echo ""
echo "=== Action Items ==="
echo ""

# Find applications that need follow-up (folders older than 7 days with "Applied" status)
echo "Applications needing follow-up:"
find applications -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r dir; do
    if [ -f "$dir/notes.md" ]; then
        FOLDER_NAME=$(basename "$dir")
        APP_DATE=$(echo "$FOLDER_NAME" | cut -d'-' -f1-3)

        # Check if older than 7 days and status is "Applied"
        STATUS=$(grep "^**Status**:" "$dir/notes.md" 2>/dev/null | cut -d':' -f2 | tr -d ' ')

        if [ "$STATUS" = "Applied" ]; then
            # Simple date comparison (works for YYYY-MM-DD format)
            if [[ "$APP_DATE" < "$WEEK_AGO" ]]; then
                DETAILS=$(echo "$FOLDER_NAME" | cut -d'-' -f4- | tr '-' ' ')
                echo "  ⚠️  $APP_DATE - $DETAILS (no response yet)"
            fi
        fi
    fi
done

echo ""
echo "=== Quick Stats ==="
echo ""
echo "For detailed tracking, see: application-tracker.md"
echo ""

# Count base documents
BASE_DOCS=$(find base-documents -type f 2>/dev/null | wc -l | tr -d ' ')
echo "📄 Base documents: $BASE_DOCS"

# Count profiles
PROFILES=$(find profiles -type f -name "*.md" ! -name "README.md" ! -name "TEMPLATE.md" 2>/dev/null | wc -l | tr -d ' ')
echo "👤 Job profiles defined: $PROFILES"

# Count template files
TEMPLATES=$(find templates -type f -name "*.md" ! -name "README.md" 2>/dev/null | wc -l | tr -d ' ')
echo "📝 Template files: $TEMPLATES"

echo ""
echo "=== Next Steps ==="
echo ""
echo "  • Update application-tracker.md with any status changes"
echo "  • Follow up on applications with no response after 1-2 weeks"
echo "  • Review and refine profiles based on response rates"
echo ""
