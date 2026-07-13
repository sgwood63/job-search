#!/usr/bin/env bash
# PreToolUse hook (matcher: Write|Edit|MultiEdit):
#   Rule 1: Block all APP_DIR writes unconditionally when READONLY_DEPLOYMENT=true.
#           This is the explicit, auditable guard for headless/containerized
#           deployments (webapp skill-runner) where no human is present to
#           answer /large-change-scoping's confirmation prompt. Interactive
#           local sessions leave this unset/false and are gated instead by
#           .claude/hooks/scope-before-write.py's intent classification.
#   Rule 2: Block Write/Edit/MultiEdit to $APPLICANT_DIR when DATA_BACKEND=ob1.
# Exit 0 = allow. Exit 2 = block (stderr message shown to Claude).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$APP_DIR/.env"

READONLY_DEPLOYMENT="false"
DATA_BACKEND="local"
APPLICANT_DIR=""

if [ -f "$ENV_FILE" ]; then
  raw=$(grep '^export READONLY_DEPLOYMENT=' "$ENV_FILE" \
    | sed "s/^export READONLY_DEPLOYMENT=['\"]*//" \
    | sed "s/['\"]* *$//")
  [ -n "$raw" ] && READONLY_DEPLOYMENT="$raw"

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
if [ "$READONLY_DEPLOYMENT" != "true" ] && [ "$DATA_BACKEND" != "ob1" ]; then
  exit 0
fi

input=$(cat)
file_path=$(printf '%s' "$input" \
  | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | sed 's/"file_path"[[:space:]]*:[[:space:]]*"//' \
  | sed 's/"$//')

[ -z "$file_path" ] && exit 0

# Rule 1: APP_DIR is unconditionally read-only in READONLY_DEPLOYMENT contexts
if [ "$READONLY_DEPLOYMENT" = "true" ]; then
  if [[ "$file_path" == "$APP_DIR" || "$file_path" == "$APP_DIR/"* ]]; then
    echo "READONLY_DEPLOYMENT is enabled. APP_DIR is unconditionally read-only in this deployment." >&2
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
