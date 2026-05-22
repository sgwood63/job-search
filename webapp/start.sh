#!/usr/bin/env bash
# Launch the job search web app (production mode: backend + vite watch).
# Access the app at http://localhost:8000
#
# Usage: bash webapp/start.sh
# Stop: Ctrl-C (kills all child processes)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
