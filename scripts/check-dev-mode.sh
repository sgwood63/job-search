#!/usr/bin/env bash
# PreToolUse hook:
#   Rule 1: Block Write/Edit to $APP_DIR when DEV_MODE != true.
#   Rule 2: Block Write/Edit to $APPLICANT_DIR when DATA_BACKEND=ob1.
# Exit 0 = allow. Exit 2 = block (stderr message shown to Claude).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$APP_DIR/.env"

DEV_MODE="false"
DATA_BACKEND="local"
APPLICANT_DIR=""

if [ -f "$ENV_FILE" ]; then
  raw=$(grep '^export DEV_MODE=' "$ENV_FILE" \
    | sed "s/^export DEV_MODE=['\"]*//" \
    | sed "s/['\"]* *$//")
  [ -n "$raw" ] && DEV_MODE="$raw"

  raw=$(grep '^export DATA_BACKEND=' "$ENV_FILE" \
    | sed "s/^export DATA_BACKEND=['\"]*//" \
    | sed "s/['\"]* *$//")
  [ -n "$raw" ] && DATA_BACKEND="$raw"

  raw=$(grep '^export APPLICANT_DIR=' "$ENV_FILE" \
    | sed "s/^export APPLICANT_DIR=['\"]*//" \
    | sed "s/['\"]* *$//")
  [ -n "$raw" ] && APPLICANT_DIR="${raw/#\~/$HOME}"
fi

# Fast-path: nothing to enforce
if [ "$DEV_MODE" = "true" ] && [ "$DATA_BACKEND" != "ob1" ]; then
  exit 0
fi

input=$(cat)
file_path=$(printf '%s' "$input" \
  | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | sed 's/"file_path"[[:space:]]*:[[:space:]]*"//' \
  | sed 's/"$//')

[ -z "$file_path" ] && exit 0

# Rule 1: APP_DIR is read-only when DEV_MODE=false
if [ "$DEV_MODE" != "true" ]; then
  if [[ "$file_path" == "$APP_DIR" || "$file_path" == "$APP_DIR/"* ]]; then
    echo "DEV_MODE is disabled. APP_DIR is read-only. Set DEV_MODE=true in .env to allow editing files in $APP_DIR." >&2
    exit 2
  fi
fi

# Rule 2: APPLICANT_DIR is read-only when DATA_BACKEND=ob1
if [ "$DATA_BACKEND" = "ob1" ] && [ -n "$APPLICANT_DIR" ]; then
  if [[ "$file_path" == "$APPLICANT_DIR" || "$file_path" == "$APPLICANT_DIR/"* ]]; then
    echo "OB1 mode is active (DATA_BACKEND=ob1). Direct writes to APPLICANT_DIR are forbidden. Use the upload_file() MCP tool instead." >&2
    exit 2
  fi
fi

exit 0
