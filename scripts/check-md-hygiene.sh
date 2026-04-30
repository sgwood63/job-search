#!/usr/bin/env bash
# check-md-hygiene.sh — reject personal names and hard-coded paths in APP_DIR .md files
#
# Usage:
#   Called automatically by .git/hooks/pre-commit (no args — checks staged .md files)
#   Manual check: bash scripts/check-md-hygiene.sh [file ...]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

# Extract applicant first name from .env without fully sourcing it
applicant_first=""
if [ -f "$ENV_FILE" ]; then
  raw=$(grep '^export APPLICANT_NAME=' "$ENV_FILE" \
    | sed "s/^export APPLICANT_NAME=['\"]*//" \
    | sed "s/['\"]* *$//")
  applicant_first=$(echo "$raw" | awk '{print $1}')
fi

# Files to check: explicit args or staged .md files
files=()
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  while IFS= read -r line; do
    [ -n "$line" ] && files+=("$line")
  done < <(git -C "$REPO_ROOT" diff --cached --name-only --diff-filter=ACM \
    | grep '\.md$' || true)
fi

[ "${#files[@]}" -eq 0 ] && exit 0

fail=0

for f in "${files[@]}"; do
  [[ "$f" = /* ]] && fp="$f" || fp="$REPO_ROOT/$f"
  [ -f "$fp" ] || continue

  # 1. Hard-coded absolute paths
  if grep -qn '/Users/' "$fp"; then
    echo "FAIL [$f]: hard-coded absolute path — use \$APP_DIR or \$APPLICANT_DIR instead"
    grep -n '/Users/' "$fp" | head -5 | sed 's/^/  /'
    fail=1
  fi

  # 2. Applicant personal name
  if [ -n "$applicant_first" ] && grep -qin "$applicant_first" "$fp"; then
    echo "FAIL [$f]: applicant name '$applicant_first' found — use 'the applicant' or a placeholder"
    grep -in "$applicant_first" "$fp" | head -5 | sed 's/^/  /'
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Fix the issues above, then re-stage and commit."
  exit 1
fi
