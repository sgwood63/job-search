#!/usr/bin/env bash
# Launch Google Chrome with a CDP debug port so /linkedin-ingest can connect
# to your live browser session (CDP mode) instead of launching a new window.
#
# Usage:
#   bash scripts/launch-chrome-debug.sh [port]
#
# Default port: 9222 (matches LINKEDIN_CDP_PORT default in .env)
#
# One-time setup:
#   1. Set CHROME_PROFILE in .env to the profile where you're logged into LinkedIn
#   2. Run this script — Chrome opens with your profile and debug port enabled
#   3. Set LINKEDIN_CDP_PORT=9222 in .env (or use the default)
#   4. Run /linkedin-ingest — it connects to the already-open Chrome
#
# Without this script, /linkedin-ingest launches Chrome fresh on each run (profile-launch
# mode), which is fine but slightly slower since Chrome has to start up each time.
#
# Note: Chrome must NOT already be running on the same profile. If it is, quit Chrome
# first, then run this script.

set -euo pipefail

PORT="${1:-9222}"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -x "$CHROME_BIN" ]]; then
    echo "[error] Google Chrome not found at: $CHROME_BIN" >&2
    echo "Install Chrome from https://www.google.com/chrome/" >&2
    exit 1
fi

# Source .env to get CHROME_PROFILE if set
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$APP_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    source "$APP_DIR/.env" 2>/dev/null || true
fi

PROFILE="${CHROME_PROFILE:-$HOME/Library/Application Support/Google/Chrome/Default}"

echo "[launch-chrome-debug] Starting Chrome on port $PORT"
echo "[launch-chrome-debug] Profile: $PROFILE"

"$CHROME_BIN" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE" \
    --no-first-run \
    --no-default-browser-check \
    &

CHROME_PID=$!
echo "[launch-chrome-debug] Chrome PID: $CHROME_PID"
echo "[launch-chrome-debug] Log into LinkedIn if needed, then run /linkedin-ingest"
echo "[launch-chrome-debug] CDP endpoint: http://localhost:$PORT"
