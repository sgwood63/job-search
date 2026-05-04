#!/usr/bin/env bash
# PreToolUse hook: blocks Write/Edit to $APP_DIR when DEV_MODE != true.
# Exit 0 = allow. Exit 2 = block (stderr message shown to Claude).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$APP_DIR/.env"

DEV_MODE="false"
if [ -f "$ENV_FILE" ]; then
  raw=$(grep '^export DEV_MODE=' "$ENV_FILE" \
    | sed "s/^export DEV_MODE=['\"]*//" \
    | sed "s/['\"]* *$//")
  [ -n "$raw" ] && DEV_MODE="$raw"
fi

[ "$DEV_MODE" = "true" ] && exit 0

input=$(cat)
file_path=$(printf '%s' "$input" \
  | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | sed 's/"file_path"[[:space:]]*:[[:space:]]*"//' \
  | sed 's/"$//')

[ -z "$file_path" ] && exit 0

if [[ "$file_path" == "$APP_DIR" || "$file_path" == "$APP_DIR/"* ]]; then
  echo "DEV_MODE is disabled. APP_DIR is read-only. Set DEV_MODE=true in .env to allow editing files in $APP_DIR." >&2
  exit 2
fi

exit 0
