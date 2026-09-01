#!/usr/bin/env bash
# audit-application.sh — deterministic completeness checks for an application folder
#
# Runs the mechanical half of the application audit. Judgment calls (is the JD
# genuinely verbatim? is Company Research a placeholder?) stay with the model —
# this script only checks what can be verified by pattern.
#
# Usage:
#   bash scripts/audit-application.sh <folder-slug> [--tier=folder|release|submission|all]
#
# Tiers (see workflows/process-jd and skills/resume-generation):
#   folder      Gate 1 — runs at end of process-jd. Advisory: never blocks ingestion.
#   release     Gate 2 — runs in resume-generation. Blocking: last point before handoff.
#   submission  Post-hoc — runs at /apply. Advisory: the submission already happened.
#   all         Every check (default).
#
# Exit codes:
#   0  no FAILs (WARNs may be present)
#   1  one or more FAILs
#   2  usage or environment error
#
# Output: one line per check, prefixed PASS / WARN / FAIL, then a summary line.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

FOLDER="${1:-}"
TIER="all"
for arg in "$@"; do
  case "$arg" in
    --tier=*) TIER="${arg#--tier=}" ;;
  esac
done

if [ -z "$FOLDER" ] || [[ "$FOLDER" == --* ]]; then
  echo "usage: bash scripts/audit-application.sh <folder-slug> [--tier=folder|release|submission|all]" >&2
  exit 2
fi
case "$TIER" in
  folder|release|submission|all) ;;
  *) echo "error: unknown tier '$TIER'" >&2; exit 2 ;;
esac

FOLDER="${FOLDER#applications/}"
FOLDER="${FOLDER%/}"

# --- environment ------------------------------------------------------------
read_env() { # key -> value; an already-exported env var wins over .env
  local cur="${!1:-}"
  if [ -n "$cur" ]; then printf '%s' "$cur"; return 0; fi
  [ -f "$ENV_FILE" ] || return 0
  grep "^export $1=" "$ENV_FILE" 2>/dev/null \
    | tail -1 \
    | sed "s/^export $1=['\"]*//" \
    | sed "s/['\"]* *$//"
}

DATA_BACKEND="$(read_env DATA_BACKEND)"; DATA_BACKEND="${DATA_BACKEND:-local}"
APPLICANT_NAME="$(read_env APPLICANT_NAME)"
APPLICANT_DIR="$(read_env APPLICANT_DIR)"
MCP_URL="$(read_env JOB_SEARCH_MCP_URL)"
MCP_KEY="${JOB_SEARCH_MCP_KEY:-$(read_env JOB_SEARCH_MCP_KEY)}"

# Applicant filename prefix, e.g. "Sherman Wood" -> "Sherman_Wood"
NAME_PREFIX="$(echo "${APPLICANT_NAME:-}" | tr ' ' '_')"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILS=0; WARNS=0; PASSES=0
pass() { echo "PASS  $1"; PASSES=$((PASSES+1)); }
warn() { echo "WARN  $1"; WARNS=$((WARNS+1)); }
fail() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

# `folder` and `submission` tiers are advisory: their FAILs are reported as WARN.
# Only `release` blocks, because it is the last gate before the PDF leaves.
emit() { # tier severity message
  local t="$1" sev="$2" msg="$3"
  if [ "$sev" = "fail" ] && [ "$t" != "release" ]; then warn "$msg"; else "$sev" "$msg"; fi
}

runs() { # tier -> should this tier run?
  [ "$TIER" = "all" ] || [ "$TIER" = "$1" ]
}

# --- file access (OB1 REST or local FS) -------------------------------------
LISTING="$WORK/listing.txt"

if [ "$DATA_BACKEND" = "ob1" ]; then
  if [ -z "$MCP_URL" ] || [ -z "$MCP_KEY" ]; then
    echo "error: DATA_BACKEND=ob1 but JOB_SEARCH_MCP_URL / JOB_SEARCH_MCP_KEY unavailable" >&2
    exit 2
  fi
  if ! curl -sf -H "x-brain-key: $MCP_KEY" \
      "$MCP_URL/api/v2/files?prefix=applications/$FOLDER/" -o "$WORK/list.json"; then
    echo "error: could not list applications/$FOLDER/ from OB1" >&2
    exit 2
  fi
  python3 -c "
import json,sys
d=json.load(open('$WORK/list.json'))
rows=d if isinstance(d,list) else d.get('files',d.get('items',[]))
for r in rows:
    k=r.get('key','') if isinstance(r,dict) else str(r)
    if k: print(k.rsplit('/',1)[-1])
" > "$LISTING" 2>/dev/null || : > "$LISTING"
  fetch() { # basename -> stdout to $WORK/$1
    curl -sf -H "x-brain-key: $MCP_KEY" \
      "$MCP_URL/api/v2/files/applications/$FOLDER/$1" -o "$WORK/$1" 2>/dev/null
  }
else
  DIR="${APPLICANT_DIR:-}/applications/$FOLDER"
  if [ ! -d "$DIR" ]; then
    echo "error: folder not found: applications/$FOLDER" >&2
    exit 2
  fi
  ls -1 "$DIR" > "$LISTING"
  fetch() { cp "$DIR/$1" "$WORK/$1" 2>/dev/null; }
fi

has() { grep -qx "$1" "$LISTING"; }
has_glob() { grep -q "$1" "$LISTING"; }

# --- section + bullet helpers -----------------------------------------------
has_heading() { # file regex
  grep -qiE "^#+ +.*$2" "$WORK/$1" 2>/dev/null
}

count_required_bullets() { # file -> bullets under the first /required/i heading-or-label
  awk '
    BEGIN{ inreq=0; n=0 }
    /^[#*]* *[Rr]equired([ _-]?[Qq]ualifications)?:?[ ]*$/ { inreq=1; next }
    inreq && /^[#]+ / { exit }
    inreq && /^[A-Za-z].*:[ ]*$/ { exit }
    inreq && /^[ ]*[-*+] / { n++ }
    END{ print n+0 }
  ' "$WORK/$1" 2>/dev/null
}

# ============================================================================
# TIER: folder
# ============================================================================
if runs folder; then
  echo "--- Gate 1: folder ---"

  if has_glob '^jd-.*\.md$'; then
    pass "verbatim JD source file present"
  else
    emit folder fail "no jd-*.md — verbatim JD source missing"
  fi

  if has "job-description.md"; then
    pass "job-description.md present"
    fetch job-description.md
    has_heading job-description.md "JD Analysis" \
      && pass "job-description.md has JD Analysis" \
      || emit folder fail "job-description.md missing JD Analysis section"
    has_heading job-description.md "Company & Market Context" \
      && pass "job-description.md has Company & Market Context" \
      || warn "job-description.md missing Company & Market Context"
  else
    emit folder fail "job-description.md missing"
  fi

  # JD completeness — the check that catches a lossy capture.
  JDSRC="$(grep -m1 '^jd-.*\.md$' "$LISTING" 2>/dev/null || true)"
  if [ -n "$JDSRC" ] && has "job-description.md"; then
    fetch "$JDSRC"
    src_n="$(count_required_bullets "$JDSRC")"
    dst_n="$(count_required_bullets job-description.md)"
    if [ "${src_n:-0}" -eq 0 ]; then
      warn "could not count Required bullets in $JDSRC — check manually"
    elif [ "${src_n:-0}" -ne "${dst_n:-0}" ]; then
      emit folder fail "JD completeness: $JDSRC has $src_n Required bullets, job-description.md has $dst_n — capture may be lossy"
    else
      pass "JD completeness: Required bullets match ($src_n)"
    fi
  fi

  if has "notes-index.md"; then
    pass "notes-index.md present (thought manifest)"
  elif has "notes.md"; then
    pass "notes.md present"
    fetch notes.md
    for sec in "Fit Assessment" "JD Analysis" "Resume Strategy" "Company Research"; do
      has_heading notes.md "$sec" \
        && pass "notes.md has $sec" \
        || emit folder fail "notes.md missing $sec"
    done
  else
    emit folder fail "neither notes-index.md nor notes.md present"
  fi
fi

# ============================================================================
# TIER: release  (blocking — last gate before the artifact leaves)
# ============================================================================
if runs release; then
  echo "--- Gate 2: release ---"

  if [ -z "$NAME_PREFIX" ]; then
    warn "APPLICANT_NAME not set in .env — skipping resume filename checks"
  else
    RES_MD="$(grep -m1 "^${NAME_PREFIX}_.*\.md$" "$LISTING" 2>/dev/null || true)"
    if [ -n "$RES_MD" ]; then
      pass "resume markdown named correctly: $RES_MD"
    else
      fail "no resume .md matching ${NAME_PREFIX}_<Role>.md"
    fi

    if has "resume.md"; then
      fail "stray resume.md present — rename to ${NAME_PREFIX}_<Role>.md and delete the duplicate"
    fi

    RES_PDF="$(grep -m1 "^${NAME_PREFIX}_.*\.pdf$" "$LISTING" 2>/dev/null || true)"
    if [ -n "$RES_PDF" ]; then
      pass "resume PDF present: $RES_PDF"
      if [ -n "$RES_MD" ] && [ "${RES_MD%.md}" != "${RES_PDF%.pdf}" ]; then
        fail "resume .md and .pdf basenames differ: ${RES_MD%.md} vs ${RES_PDF%.pdf}"
      elif [ -n "$RES_MD" ]; then
        pass "resume .md / .pdf basenames match"
      fi
    else
      fail "no resume .pdf matching ${NAME_PREFIX}_<Role>.pdf"
    fi
  fi
fi

# ============================================================================
# TIER: submission  (post-hoc — advisory only)
# ============================================================================
if runs submission; then
  echo "--- Post-hoc: submission ---"
  if [ -n "$NAME_PREFIX" ] && has_glob "^${NAME_PREFIX}_.*\.pdf$"; then
    pass "a resume PDF exists to have submitted"
  else
    emit submission fail "no resume PDF in folder"
  fi
fi

echo "---"
echo "$PASSES passed, $WARNS warning(s), $FAILS failure(s)  [tier=$TIER backend=$DATA_BACKEND]"
[ "$FAILS" -eq 0 ] || exit 1
exit 0
