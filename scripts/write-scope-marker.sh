#!/usr/bin/env bash
# Write the session-scoped large-change-scoping marker.
# Called by /large-change-scoping step 4 to unblock APP_DIR writes for this session.
set -euo pipefail

STATE_FILE="$HOME/.claude/state/current-session-id"
if [[ ! -f "$STATE_FILE" ]]; then
    echo "Error: no current-session-id found at $STATE_FILE" >&2
    exit 1
fi

SESSION_ID=$(cat "$STATE_FILE")
MARKER_DIR="$HOME/.claude/session-env/$SESSION_ID"
mkdir -p "$MARKER_DIR"
touch "$MARKER_DIR/.large-change-scoped"
echo "Session $SESSION_ID unblocked for repo writes."
