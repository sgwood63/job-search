#!/usr/bin/env bash
# status-line.sh — Dynamic Claude Code status bar for Job Search 2026
# Called by .claude/settings.json statusLine command.
# Reads application-tracker.md and outputs a live formatted status line.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

# Source .env to resolve APPLICANT_DIR
if [[ -f "$APP_DIR/.env" ]]; then
  # shellcheck source=/dev/null
  source "$APP_DIR/.env"
fi

TRACKER="${APPLICANT_DIR}/application-tracker.md"

if [[ ! -f "$TRACKER" ]]; then
  printf "Job Search 2026 | tracker missing | Drop a JD to screen"
  exit 0
fi

# Extract the ## Active Applications section only (stop at next ## heading)
active_section=$(awk '/^## Active Applications/{found=1; next} found && /^## /{exit} found{print}' "$TRACKER")

# Count data rows: lines starting with "| 20" (dated application entries)
total_rows=$(printf '%s\n' "$active_section" | grep -c '^| 20' || true)

# Count unreviewed rows (status contains "pending review")
pending=$(printf '%s\n' "$active_section" | grep -c 'pending review' || true)

# Active = engaged rows (applied, recruiter contact, under review, not yet submitted)
active=$((total_rows - pending))
[[ $active -lt 0 ]] && active=0

# Find nearest upcoming "Follow up YYYY-MM-DD" date in the Next Action column
today=$(date '+%Y-%m-%d')
next_followup=$(printf '%s\n' "$active_section" | \
  grep -oE 'Follow up [0-9]{4}-[0-9]{2}-[0-9]{2}' | \
  sed 's/Follow up //' | \
  sort -u | \
  awk -v t="$today" '$0 >= t {print; exit}')

if [[ -n "$next_followup" ]]; then
  followup_fmt=$(date -j -f "%Y-%m-%d" "$next_followup" "+%b %d" 2>/dev/null || echo "$next_followup")
  suffix="Follow-up $followup_fmt"
else
  suffix="Drop a JD to screen"
fi

printf "Job Search 2026 | %d active | %d pending review | %s" "$active" "$pending" "$suffix"
