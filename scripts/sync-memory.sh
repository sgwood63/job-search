#!/usr/bin/env bash
# Auto-syncs $APP_DIR/memory/ to git and ~/.claude/ after every session response.
# Run by the Claude Code Stop hook. Idempotent: exits silently if nothing changed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

cd "$APP_DIR"

# Exit silently if nothing to commit
if git diff --quiet memory/ && ! git ls-files --others --exclude-standard memory/ | grep -q .; then
  exit 0
fi

TIMESTAMP="$(date '+%Y-%m-%d %H:%M')"
git add memory/
git commit -m "Auto-sync memory: $TIMESTAMP"

CLAUDE_MEM="$HOME/.claude/projects/$(echo "$APP_DIR" | sed 's|/|-|g')/memory/"
cp memory/*.md "$CLAUDE_MEM"
