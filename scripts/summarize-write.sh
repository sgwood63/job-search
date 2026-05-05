#!/usr/bin/env bash
# PostToolUse hook: outputs a one-line impact summary for significant file writes.
# Called after Write tool calls. Reads JSON from stdin (tool_input.file_path).
# Outputs nothing (exits 0) for unclassified files to avoid noise.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env for APPLICANT_DIR
if [[ -f "$APP_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  source "$APP_DIR/.env"
fi

APPLICANT_DIR="${APPLICANT_DIR:-}"

# Read file_path from hook JSON input
FILE_PATH=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0

BASENAME=$(basename "$FILE_PATH")
DIRNAME=$(dirname "$FILE_PATH")

# Classify and output one summary line
case "$FILE_PATH" in
  # Application notes
  */applications/*/notes.md)
    FOLDER=$(basename "$(dirname "$FILE_PATH")")
    # Extract company/role from folder name (strip date prefix YYYY-MM-DD-)
    LABEL="${FOLDER#????-??-??-}"
    printf "📝 Notes updated: %s\n" "$LABEL"
    ;;

  # Application tracker
  */application-tracker.md)
    printf "📋 Tracker updated\n"
    ;;

  # Resume .md files (named FirstName_LastName_Role.md in an applications/ folder)
  */applications/*/*_*.md)
    printf "📄 Resume draft saved: %s\n" "$BASENAME"
    ;;

  # Job description files
  */applications/*/job-description.md)
    FOLDER=$(basename "$(dirname "$FILE_PATH")")
    LABEL="${FOLDER#????-??-??-}"
    printf "🔍 JD processed: %s\n" "$LABEL"
    ;;

  # APP_DIR memory files
  */memory/*.md)
    # Extract name from frontmatter if available
    if [[ -f "$FILE_PATH" ]]; then
      MEM_NAME=$(awk 'BEGIN{p=0} /^---/{p++; next} p==1 && /^name:/{sub(/^name:[[:space:]]*/,""); print; exit}' "$FILE_PATH" 2>/dev/null)
    fi
    MEM_NAME="${MEM_NAME:-$BASENAME}"
    printf "🧠 Memory updated: %s\n" "$MEM_NAME"
    ;;

  # APP_DIR config / scripts
  */\.claude/settings*.json)
    printf "⚙️  Settings updated: %s\n" "$BASENAME"
    ;;

  */scripts/*.sh|*/scripts/*.py)
    printf "🔧 Script updated: %s\n" "$BASENAME"
    ;;

  # APP_DIR markdown source files
  */CLAUDE.md|*/workflow.md|*/applicant-setup.md)
    printf "📖 App doc updated: %s\n" "$BASENAME"
    ;;

  # Everything else — no output (avoid noise for temp files, HTML intermediates, etc.)
  *)
    exit 0
    ;;
esac
