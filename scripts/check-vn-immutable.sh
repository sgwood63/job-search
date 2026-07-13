#!/usr/bin/env bash
# PreToolUse hook: Block Write/Edit to committed vN.md files in $APP_DIR.
# vN.md files are immutable after promotion. Use draft.md → promote instead.
# An active large-change-scoping session marker allows editing other APP_DIR
# files but does NOT unlock vN.md.
# Exit 0 = allow. Exit 2 = block (stderr message shown to Claude).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

input=$(cat)
file_path=$(printf '%s' "$input" \
  | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | sed 's/"file_path"[[:space:]]*:[[:space:]]*"//' \
  | sed 's/"$//')

[ -z "$file_path" ] && exit 0

# Only check files inside APP_DIR
[[ "$file_path" != "$APP_DIR/"* ]] && exit 0

# Block if filename matches v<digits>.md (e.g. v1.md, v2.md, v12.md)
filename="$(basename "$file_path")"
if [[ "$filename" =~ ^v[0-9]+\.md$ ]]; then
  echo "BLOCKED: '$file_path' is a committed version file (vN.md) and is immutable." >&2
  echo "To make changes: create 'draft.md' in the same directory, edit it, then promote to vN+1.md." >&2
  exit 2
fi

exit 0
