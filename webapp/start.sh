#!/usr/bin/env bash
# Launch the job search web app (production mode: backend + vite watch).
# Access the app at http://localhost:8000
#
# Usage: bash webapp/start.sh
# Stop: Ctrl-C (kills all child processes)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load .env so CLAUDE_BINARY is available for the version check
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck source=/dev/null
  set -a; source "$ENV_FILE"; set +a
fi

CLAUDE_BIN="${CLAUDE_BINARY:-claude}"
CLAUDE_VER=$("$CLAUDE_BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
REQUIRED_PATCH=152
ACTUAL_PATCH=$(echo "$CLAUDE_VER" | cut -d. -f3)
if [ -z "$CLAUDE_VER" ] || [ -z "$ACTUAL_PATCH" ] || [ "$ACTUAL_PATCH" -lt "$REQUIRED_PATCH" ]; then
  echo "ERROR: claude binary at '$CLAUDE_BIN' is version ${CLAUDE_VER:-unknown} — need 2.1.$REQUIRED_PATCH+."
  echo "Set CLAUDE_BINARY in .env to the VS Code extension path, or run: npm update -g @anthropic-ai/claude-code"
  exit 1
fi
echo "Claude Code $CLAUDE_VER OK"

cleanup() {
  echo ""
  echo "Stopping..."
  kill 0
}
trap cleanup EXIT INT TERM

echo "Starting backend (port 8000)..."
cd "$SCRIPT_DIR/backend"
uvicorn main:app --reload --port 8000 &

echo "Starting vite build --watch (auto-rebuilds dist on change)..."
cd "$SCRIPT_DIR/frontend"
npm run watch &

echo ""
echo "App running at http://localhost:8000"
echo "Press Ctrl-C to stop."
wait
