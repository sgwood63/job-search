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

git add memory/

# Read 'name' from frontmatter; fall back to basename
get_mem_name() {
  local file="$1"
  local name
  name=$(awk 'BEGIN{p=0} /^---/{p++; next} p==1 && /^name:/{sub(/^name:[[:space:]]*/,""); print; exit}' "$file" 2>/dev/null)
  echo "${name:-$(basename "$file" .md)}"
}

ADDED_NAMES=()
MOD_NAMES=()
DEL_NAMES=()

while IFS=$'\t' read -r status filepath; do
  filename="${filepath#memory/}"
  [[ "$filename" == "MEMORY.md" ]] && continue  # always derivative — skip
  case "$status" in
    A) ADDED_NAMES+=("$(get_mem_name "$APP_DIR/$filepath")") ;;
    M) MOD_NAMES+=("$(get_mem_name "$APP_DIR/$filepath")") ;;
    D) DEL_NAMES+=("$(git show "HEAD:$filepath" | awk 'BEGIN{p=0} /^---/{p++; next} p==1 && /^name:/{sub(/^name:[[:space:]]*/,""); print; exit}' 2>/dev/null || echo "$filename")") ;;
  esac
done < <(git diff --cached --name-status -- memory/)

TOTAL=$(( ${#ADDED_NAMES[@]} + ${#MOD_NAMES[@]} + ${#DEL_NAMES[@]} ))

if [[ $TOTAL -eq 0 ]]; then
  MSG="memory: update index"
elif [[ $TOTAL -gt 4 ]]; then
  MSG="memory: sync $TOTAL entries ($(date '+%Y-%m-%d %H:%M'))"
else
  PARTS=()
  [[ ${#ADDED_NAMES[@]} -gt 0 ]] && PARTS+=("add $(IFS=', '; echo "${ADDED_NAMES[*]}")")
  [[ ${#MOD_NAMES[@]} -gt 0 ]]   && PARTS+=("update $(IFS=', '; echo "${MOD_NAMES[*]}")")
  [[ ${#DEL_NAMES[@]} -gt 0 ]]   && PARTS+=("remove $(IFS=', '; echo "${DEL_NAMES[*]}")")
  MSG="memory: $(IFS='; '; echo "${PARTS[*]}")"
fi

git commit -m "$MSG"

CLAUDE_MEM="$HOME/.claude/projects/$(echo "$APP_DIR" | sed 's|/|-|g')/memory/"
cp memory/*.md "$CLAUDE_MEM"
