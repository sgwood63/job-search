#!/bin/bash
# setup.sh — Job Search 2026 setup
#
# Run from the repo root after cloning:
#   bash scripts/setup.sh
#
# Detects existing applicant or sets up a new one.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
TEMPLATES_DIR="$REPO_ROOT/templates/scaffold"

# ── Helpers ────────────────────────────────────────────────────────────────

bold()   { printf '\033[1m%s\033[0m' "$1"; }
green()  { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
red()    { printf '\033[31m%s\033[0m' "$1"; }

prompt() {
    local label="$1" default="$2"
    if [[ -n "$default" ]]; then
        printf '%s [%s]: ' "$label" "$(yellow "$default")"
    else
        printf '%s: ' "$label"
    fi
    read -r REPLY
    [[ -z "$REPLY" ]] && REPLY="$default"
}

confirm() {
    printf '%s [Y/n]: ' "$1"
    read -r REPLY
    [[ -z "$REPLY" || "$REPLY" =~ ^[Yy] ]]
}

print_section() {
    echo ""
    echo "$(bold "── $1 ──────────────────────────────────────────────────────────────────")"
    echo ""
}

scaffold_file() {
    local path="$1" template="$2"
    if [[ -e "$path" ]]; then
        echo "  $(yellow "–") exists: $path"
    else
        mkdir -p "$(dirname "$path")"
        sed "s|\${APPLICANT_NAME}|${APPLICANT_NAME}|g" "$template" > "$path"
        echo "  $(green "✓") created: $path"
    fi
}

# ── Header ─────────────────────────────────────────────────────────────────

clear
echo ""
echo "$(bold "Job Search 2026 — Setup")"
echo ""
echo "This script will:"
echo "  1. Verify Claude Code and configure authentication"
echo "  2. Detect existing applicant or set up a new one"
echo "  3. Install PDF generation dependencies"
echo "  4. Configure Google Drive sync"
echo "  5. Write .env and scaffold the applicant directory"
echo ""
echo "$(yellow "APP_DIR (this repo): $REPO_ROOT")"
echo ""
if ! confirm "Ready to begin?"; then
    echo "Aborted."
    exit 0
fi

# ── Claude Code + Authentication ────────────────────────────────────────────
#
# Uses `claude auth status` to both verify Claude Code is installed and
# determine the auth method in one step:
#   exit 127  → command not found → Claude Code not installed → exit
#   exit 0    → OAuth active → no API key needed
#   other     → installed but no OAuth → prompt for API key

print_section "Claude Code & Authentication"

USE_OAUTH=false
ANTHROPIC_API_KEY=""

set +e
auth_output=$(claude auth status --text 2>&1)
auth_exit=$?
set -e

if [[ $auth_exit -eq 127 ]]; then
    echo "$(red "✗") Claude Code not found in PATH."
    echo "  Claude Code is the AI runtime for this system. Install it first:"
    echo "    npm install -g @anthropic-ai/claude-code"
    echo "  Or download the desktop app at https://claude.ai/code"
    exit 1
elif [[ $auth_exit -eq 0 ]]; then
    USE_OAUTH=true
    echo "$(green "✓") Claude Code OAuth active"
    echo "  $auth_output"
else
    echo "  $auth_output"
    echo ""
    echo "No active OAuth session — API key required."
    echo "Get your key at https://console.anthropic.com/"
    echo ""

    # Pull existing key from .env or current shell for the default
    EXISTING_API_KEY="${ANTHROPIC_API_KEY:-}"
    if [[ -z "$EXISTING_API_KEY" && -f "$ENV_FILE" ]]; then
        set +e
        # shellcheck disable=SC1090
        _loaded_key=$(source "$ENV_FILE" 2>/dev/null && echo "${ANTHROPIC_API_KEY:-}")
        set -e
        EXISTING_API_KEY="$_loaded_key"
    fi

    while true; do
        if [[ -n "$EXISTING_API_KEY" && -z "$ANTHROPIC_API_KEY" ]]; then
            MASKED="${EXISTING_API_KEY:0:8}…${EXISTING_API_KEY: -4}"
            echo "Found existing key: $(yellow "$MASKED")"
            if confirm "Use this key?"; then
                ANTHROPIC_API_KEY="$EXISTING_API_KEY"
            else
                printf 'Enter new Anthropic API key: '
                read -rs ANTHROPIC_API_KEY
                echo ""
            fi
        else
            printf 'Anthropic API key (Enter to skip): '
            read -rs ANTHROPIC_API_KEY
            echo ""
        fi

        if [[ -z "$ANTHROPIC_API_KEY" ]]; then
            echo "$(yellow "⚠") No key entered. Run 'claude auth login' or add ANTHROPIC_API_KEY to .env manually."
            break
        fi

        echo "Validating key…"
        set +e
        validate_output=$(ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" claude auth status --text 2>&1)
        validate_exit=$?
        set -e
        echo "  $validate_output"
        if [[ $validate_exit -eq 0 ]]; then
            echo "$(green "✓") Key validated"
            break
        else
            echo "$(red "✗") Auth check failed."
            if confirm "Retry with a different key?"; then
                EXISTING_API_KEY=""
                ANTHROPIC_API_KEY=""
            else
                echo "$(yellow "⚠") Continuing with unvalidated key. Update .env manually if needed."
                break
            fi
        fi
    done
fi

# ── Pre-populate from existing .env ────────────────────────────────────────

EXISTING_APPLICANT_NAME=""
EXISTING_APPLICANT_DIR=""
EXISTING_GDRIVE_DIR=""

if [[ -f "$ENV_FILE" ]]; then
    set +e
    # shellcheck disable=SC1090
    source "$ENV_FILE" 2>/dev/null
    set -e
    EXISTING_APPLICANT_NAME="${APPLICANT_NAME:-}"
    EXISTING_APPLICANT_DIR="${APPLICANT_DIR:-}"
    EXISTING_GDRIVE_DIR="${GDRIVE_DIR:-}"
fi

# ── Shared helpers (used by both refresh and new-applicant paths) ───────────

detect_gdrive_base() {
    # Sets GDRIVE_BASE to the detected "My Drive" root, or empty if not found.
    GDRIVE_BASE=""
    if [[ "$(uname)" == "Darwin" ]]; then
        local cloudstore="$HOME/Library/CloudStorage"
        if [[ -d "$cloudstore" ]]; then
            mapfile -t _mounts < <(ls "$cloudstore" 2>/dev/null | grep "^GoogleDrive-")
            if [[ ${#_mounts[@]} -eq 1 ]]; then
                GDRIVE_BASE="$cloudstore/${_mounts[0]}/My Drive"
                echo "  Detected Google Drive: $(yellow "${_mounts[0]}")"
            elif [[ ${#_mounts[@]} -gt 1 ]]; then
                echo "  Multiple Google Drive mounts found:"
                for i in "${!_mounts[@]}"; do
                    echo "    $((i+1)). ${_mounts[$i]}"
                done
                prompt "  Which account to use?" "1"
                local idx=$(( REPLY - 1 ))
                GDRIVE_BASE="$cloudstore/${_mounts[$idx]}/My Drive"
            fi
        fi
    fi
}

run_deps() {
    print_section "PDF Generation Dependencies"
    local missing=()
    command -v pandoc  &>/dev/null || missing+=("pandoc (brew install pandoc)")
    command -v pdfinfo &>/dev/null || missing+=("poppler (brew install poppler)")
    python3 -c "import weasyprint" &>/dev/null 2>&1 || missing+=("weasyprint (pip install weasyprint)")

    if [[ ${#missing[@]} -eq 0 ]]; then
        echo "$(green "✓") All dependencies installed (pandoc, poppler, weasyprint)"
    else
        echo "Missing dependencies:"
        for dep in "${missing[@]}"; do echo "  • $dep"; done
        echo ""
        if confirm "Install missing dependencies now?"; then
            command -v pandoc  &>/dev/null || brew install pandoc
            command -v pdfinfo &>/dev/null || brew install poppler
            python3 -c "import weasyprint" &>/dev/null 2>&1 || pip3 install weasyprint
            echo "$(green "✓") Dependencies installed"
        else
            echo "$(yellow "⚠") Skipped. PDF generation will not work until these are installed."
        fi
    fi
}

write_env() {
    cat > "$ENV_FILE" << ENVEOF
# Job Search 2026 — Environment Configuration
# Generated by scripts/setup.sh — gitignored, never commit this file.
# To update, edit this file directly or re-run: bash scripts/setup.sh

export APPLICANT_NAME="${APPLICANT_NAME}"
export APP_DIR="${REPO_ROOT}"
export APPLICANT_DIR="${APPLICANT_DIR}"
ENVEOF

    if [[ -n "${GDRIVE_DIR:-}" ]]; then
        echo "export GDRIVE_DIR=\"${GDRIVE_DIR}\"" >> "$ENV_FILE"
    else
        echo "# GDRIVE_DIR not set — Google Drive not detected locally" >> "$ENV_FILE"
    fi

    if $USE_OAUTH; then
        echo "# ANTHROPIC_API_KEY not needed — using Claude Code OAuth" >> "$ENV_FILE"
    elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        echo "export ANTHROPIC_API_KEY=\"${ANTHROPIC_API_KEY}\"" >> "$ENV_FILE"
    else
        echo "# export ANTHROPIC_API_KEY=\"sk-ant-...\"" >> "$ENV_FILE"
    fi

    echo "$(green "✓") Written: $ENV_FILE"
}

run_verification() {
    print_section "Verification"
    set +e
    # shellcheck disable=SC1090
    source "$ENV_FILE" 2>/dev/null
    set -e
    echo "  APPLICANT_NAME = ${APPLICANT_NAME:-(not set)}"
    echo "  APP_DIR        = ${APP_DIR:-$REPO_ROOT}"
    echo "  APPLICANT_DIR  = ${APPLICANT_DIR:-}"
    if [[ -n "${GDRIVE_DIR:-}" ]]; then
        echo "  GDRIVE_DIR     = ${GDRIVE_DIR}"
    else
        echo "  GDRIVE_DIR     = $(yellow "(not set)")"
    fi
    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        echo "  ANTHROPIC_API_KEY = ${ANTHROPIC_API_KEY:0:8}…${ANTHROPIC_API_KEY: -4}"
    else
        echo "  ANTHROPIC_API_KEY = $(yellow "(not set — OAuth active)")"
    fi

    if [[ -n "${GDRIVE_DIR:-}" && -d "${APPLICANT_DIR:-}" ]]; then
        echo ""
        echo "Testing rsync dry run…"
        if rsync -a --dry-run --exclude='node_modules' --exclude='_temp-*' \
            "$APPLICANT_DIR/" "$GDRIVE_DIR/" 2>&1 | head -3; then
            echo "$(green "✓") Sync path verified"
        fi
    fi
}

# ── Existing applicant ──────────────────────────────────────────────────────

if [[ -n "$EXISTING_APPLICANT_DIR" && -d "$EXISTING_APPLICANT_DIR" ]]; then
    print_section "Existing Applicant Detected"
    if [[ -n "$EXISTING_APPLICANT_NAME" ]]; then
        echo "  Applicant : $(bold "$EXISTING_APPLICANT_NAME")"
    fi
    echo "  Directory : $EXISTING_APPLICANT_DIR"
    echo ""

    if confirm "Refresh existing setup?"; then
        APPLICANT_NAME="$EXISTING_APPLICANT_NAME"
        APPLICANT_DIR="$EXISTING_APPLICANT_DIR"
        GDRIVE_DIR="$EXISTING_GDRIVE_DIR"

        run_deps

        print_section "Google Drive Sync Path"
        detect_gdrive_base
        if [[ -n "$GDRIVE_BASE" ]]; then
            # Derive folder name from existing applicant dir basename
            local_slug="$(basename "$EXISTING_APPLICANT_DIR")"
            DEFAULT_GDRIVE="${EXISTING_GDRIVE_DIR:-$GDRIVE_BASE/$local_slug}"
            prompt "Google Drive sync folder" "$DEFAULT_GDRIVE"
            GDRIVE_DIR="$REPLY"
            if [[ -n "$GDRIVE_DIR" && ! -d "$GDRIVE_DIR" ]]; then
                if confirm "Folder does not exist. Create it?"; then
                    mkdir -p "$GDRIVE_DIR"
                    echo "$(green "✓") Created: $GDRIVE_DIR"
                else
                    echo "$(yellow "⚠") Skipped. Sync will fail until this folder exists."
                fi
            elif [[ -n "$GDRIVE_DIR" ]]; then
                echo "$(green "✓") Exists: $GDRIVE_DIR"
            fi
        else
            echo "  $(yellow "–") Google Drive not detected. GDRIVE_DIR unchanged."
            GDRIVE_DIR="$EXISTING_GDRIVE_DIR"
        fi

        write_env
        run_verification

        echo ""
        echo "$(bold "════════════════════════════════════════════════")"
        echo "$(green "Refresh complete!")"
        echo "$(bold "════════════════════════════════════════════════")"
        echo ""
        exit 0
    fi

    echo ""
    # User declined refresh — fall through to new applicant creation
fi

# ── New applicant ────────────────────────────────────────────────────────────

print_section "New Applicant Setup"

if ! confirm "Create a new applicant?"; then
    echo "Aborted."
    exit 0
fi

echo ""
printf 'Applicant name: '
read -r APPLICANT_NAME
if [[ -z "$APPLICANT_NAME" ]]; then
    echo "$(red "✗") Applicant name is required."
    exit 1
fi
echo "$(green "✓") Name: $APPLICANT_NAME"

SLUG="$(echo "$APPLICANT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')"

# ── Step 1: Applicant Directory ─────────────────────────────────────────────

print_section "Step 1 — Applicant Directory"
echo "Holds all applications, profiles, and documents. Not git-tracked."
echo ""

if [[ "$(uname)" == "Darwin" || "$(uname)" == "Linux" ]]; then
    DOCS_DIR="${XDG_DOCUMENTS_DIR:-$HOME/Documents}"
else
    DOCS_DIR="$HOME/Documents"
fi

DEFAULT_APPLICANT_DIR="$DOCS_DIR/job-applicant-$SLUG"
prompt "Applicant directory path" "$DEFAULT_APPLICANT_DIR"
APPLICANT_DIR="$REPLY"

if [[ ! -d "$APPLICANT_DIR" ]]; then
    if confirm "Directory does not exist. Create it?"; then
        mkdir -p "$APPLICANT_DIR"
        echo "$(green "✓") Created: $APPLICANT_DIR"
    else
        echo "$(red "✗") Cannot continue without the applicant directory."
        exit 1
    fi
else
    echo "$(green "✓") Exists: $APPLICANT_DIR"
fi

# ── Step 2: PDF Dependencies ────────────────────────────────────────────────

run_deps

# ── Step 3: Google Drive ────────────────────────────────────────────────────

print_section "Step 3 — Google Drive Sync Path"
echo "The applicant directory syncs to Google Drive after every content generation step."
echo ""

GDRIVE_DIR=""
detect_gdrive_base

if [[ -n "$GDRIVE_BASE" ]]; then
    DEFAULT_GDRIVE="$GDRIVE_BASE/job-applicant-$SLUG"
    prompt "Google Drive sync folder" "$DEFAULT_GDRIVE"
    GDRIVE_DIR="$REPLY"
    if [[ -n "$GDRIVE_DIR" ]]; then
        if [[ ! -d "$GDRIVE_DIR" ]]; then
            if confirm "Folder does not exist. Create it?"; then
                mkdir -p "$GDRIVE_DIR"
                echo "$(green "✓") Created: $GDRIVE_DIR"
            else
                echo "$(yellow "⚠") Skipped. Sync will fail until this folder exists."
            fi
        else
            echo "$(green "✓") Exists: $GDRIVE_DIR"
        fi
    fi
else
    echo "$(yellow "–") Google Drive not detected locally. GDRIVE_DIR will not be set."
    echo "  Install the Google Drive desktop app and re-run this script to configure sync."
fi

# ── Step 4: Write .env ──────────────────────────────────────────────────────

print_section "Step 4 — Writing .env"
write_env

# ── Step 5: Scaffold applicant directory ────────────────────────────────────

print_section "Step 5 — Applicant Directory Structure"
echo "Creating directories and stub files (existing files are never overwritten)."
echo ""

for dir in profiles base-documents applications memory; do
    if [[ ! -d "$APPLICANT_DIR/$dir" ]]; then
        mkdir -p "$APPLICANT_DIR/$dir"
        echo "  $(green "✓") created: $APPLICANT_DIR/$dir/"
    else
        echo "  $(yellow "–") exists:  $APPLICANT_DIR/$dir/"
    fi
done

echo ""

scaffold_file "$APPLICANT_DIR/applicant.md"                                  "$TEMPLATES_DIR/applicant.md"
scaffold_file "$APPLICANT_DIR/application-tracker.md"                         "$TEMPLATES_DIR/application-tracker.md"
scaffold_file "$APPLICANT_DIR/base-documents/EXPERIENCE-REFERENCE.md"         "$TEMPLATES_DIR/base-documents/EXPERIENCE-REFERENCE.md"
scaffold_file "$APPLICANT_DIR/base-documents/resume-content-guidance.md"      "$TEMPLATES_DIR/base-documents/resume-content-guidance.md"
scaffold_file "$APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md"           "$TEMPLATES_DIR/profiles/PROFILES-QUICK-REFERENCE.md"
scaffold_file "$APPLICANT_DIR/memory/APPLICANT-MEMORY.md"                     "$TEMPLATES_DIR/memory/APPLICANT-MEMORY.md"

# ── Verification ────────────────────────────────────────────────────────────

run_verification

# ── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "$(bold "════════════════════════════════════════════════")"
echo "$(green "Setup complete!")"
echo "$(bold "════════════════════════════════════════════════")"
echo ""
echo "To activate in your current shell:"
echo "  $(bold "source .env")"
echo ""
echo "Next: run the applicant setup process."
echo "  Open a Claude Code session and follow: $(bold "applicant-setup.md")"
echo "  Claude will interview the applicant, extract content from uploaded documents,"
echo "  and generate applicant.md, EXPERIENCE-REFERENCE.md, and all profile files."
echo ""
