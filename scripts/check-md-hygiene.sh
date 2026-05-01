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
  # Normalize to repo-relative path for sentinel matching
  relpath="${fp#$REPO_ROOT/}"

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

  # 3. Sentinel: README/QUICK-START must not describe CLAUDE.md as containing "complete workflow"
  #    CLAUDE.md is Tier 1 (triggers + critical rules only); workflow detail lives in workflow.md
  if [[ "$relpath" == "README.md" || "$relpath" == "QUICK-START.md" ]]; then
    if grep -qin "complete workflow\|all workflow rules" "$fp"; then
      echo "FAIL [$f]: stale CLAUDE.md description — use 'critical rules and workflow triggers'; workflow detail is in workflow.md"
      grep -in "complete workflow\|all workflow rules" "$fp" | head -5 | sed 's/^/  /'
      fail=1
    fi
  fi

  # 4. Sentinel: PROFILES-README must not reference Phase D for example JDs (they belong to Phase E)
  if [[ "$relpath" == "templates/PROFILES-README.md" ]]; then
    if grep -qin "phase d" "$fp"; then
      echo "FAIL [$f]: stale phase reference — example JDs are added in Phase E, not Phase D"
      grep -in "phase d" "$fp" | head -5 | sed 's/^/  /'
      fail=1
    fi
  fi

  # 5. Sentinel: applicant-setup.md must not use fixed P? column in achievement table
  #    Profile count is variable per applicant; use P1 | P2 | … | Pn notation instead
  if [[ "$relpath" == "applicant-setup.md" ]]; then
    if grep -qF 'P?' "$fp"; then
      echo "FAIL [$f]: stale achievement table template — use 'P1 | P2 | … | Pn' (variable per applicant, not fixed slots)"
      grep -nF 'P?' "$fp" | head -5 | sed 's/^/  /'
      fail=1
    fi
  fi

  # 6. Sentinel: CLAUDE.md domain connection rule must list four sources (not three)
  if [[ "$relpath" == "CLAUDE.md" ]]; then
    if grep -qin "three sources" "$fp"; then
      echo "FAIL [$f]: stale domain connection rule — must list four sources (professional roles, personal/life experience, specific artifacts built, use-case connections)"
      grep -in "three sources" "$fp" | head -5 | sed 's/^/  /'
      fail=1
    fi
  fi
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Fix the issues above, then re-stage and commit."
  exit 1
fi
