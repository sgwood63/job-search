#!/usr/bin/env bash
# Stop hook: reindexes codebase-memory-mcp when the repo has changed since the
# last index, so the graph doesn't drift from the working tree (e.g. new
# draft.md files). Idempotent and non-blocking: exits immediately whether or
# not a reindex was kicked off; the reindex itself runs detached.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR" || exit 0

CLI_BIN="$(command -v codebase-memory-mcp 2>/dev/null)"
[ -z "$CLI_BIN" ] && exit 0

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

STATE_DIR="$HOME/.claude/state/codebase-memory-index"
mkdir -p "$STATE_DIR"
SANITIZED="$(echo "$APP_DIR" | sed 's|/|-|g')"
MARKER_FILE="$STATE_DIR/$SANITIZED.signal"
LOG_FILE="$STATE_DIR/$SANITIZED.log"
LOCK_FILE="$STATE_DIR/$SANITIZED.lock"

CURRENT_SIGNAL="$(git rev-parse HEAD 2>/dev/null)-$(git status --porcelain 2>/dev/null | shasum | awk '{print $1}')"

# Nothing changed since the last successful index — no-op.
if [ -f "$MARKER_FILE" ] && [ "$(cat "$MARKER_FILE" 2>/dev/null)" = "$CURRENT_SIGNAL" ]; then
  exit 0
fi

# A previous background reindex is still running — don't stack another.
if [ -f "$LOCK_FILE" ] && kill -0 "$(cat "$LOCK_FILE" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi

(
  echo $$ > "$LOCK_FILE"
  "$CLI_BIN" cli index_repository "{\"repo_path\": \"$APP_DIR\", \"mode\": \"moderate\"}" >> "$LOG_FILE" 2>&1
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "$CURRENT_SIGNAL" > "$MARKER_FILE"
  fi
  rm -f "$LOCK_FILE"
) >/dev/null 2>&1 &
disown

exit 0
