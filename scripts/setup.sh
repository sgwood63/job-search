#!/bin/bash
# setup.sh — First-time setup for Job Search 2026
#
# Run from the repo root after cloning:
#   bash scripts/setup.sh
#
# Creates .env with your local paths and installs dependencies.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

# ── Helpers ────────────────────────────────────────────────────────────────

bold() { printf '\033[1m%s\033[0m' "$1"; }
green() { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
red() { printf '\033[31m%s\033[0m' "$1"; }

prompt() {
    # prompt <label> <default>  →  prints prompt, reads into REPLY
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
    # confirm <question>  →  returns 0 for yes, 1 for no
    printf '%s [Y/n]: ' "$1"
    read -r REPLY
    [[ -z "$REPLY" || "$REPLY" =~ ^[Yy] ]]
}

print_section() {
    echo ""
    echo "$(bold "── $1 ──────────────────────────────────────────────────────────────────")"
    echo ""
}

# ── Header ─────────────────────────────────────────────────────────────────

clear
echo ""
echo "$(bold "Job Search 2026 — First-Time Setup")"
echo ""
echo "This script will:"
echo "  1. Locate or create the applicant data directory"
echo "  2. Install PDF generation dependencies (pandoc, weasyprint, poppler)"
echo "  3. Find your Google Drive sync path"
echo "  4. Set your Anthropic API key"
echo "  5. Write .env with all configuration"
echo ""
echo "$(yellow "APP_DIR (this repo) is already set: $REPO_ROOT")"
echo ""
if ! confirm "Ready to begin?"; then
    echo "Aborted."
    exit 0
fi

# ── Pre-populate from existing .env ────────────────────────────────────────

EXISTING_APPLICANT_DIR=""
EXISTING_GDRIVE_DIR=""
EXISTING_API_KEY=""

if [[ -f "$ENV_FILE" ]]; then
    print_section "Existing .env found"
    echo "Loading previous values as defaults…"
    # shellcheck disable=SC1090
    source "$ENV_FILE" 2>/dev/null || true
    EXISTING_APPLICANT_DIR="${APPLICANT_DIR:-}"
    EXISTING_GDRIVE_DIR="${GDRIVE_DIR:-}"
    EXISTING_API_KEY="${ANTHROPIC_API_KEY:-}"
fi

# Also pick up API key from current shell if not already found
if [[ -z "$EXISTING_API_KEY" && -n "${ANTHROPIC_API_KEY:-}" ]]; then
    EXISTING_API_KEY="$ANTHROPIC_API_KEY"
fi

# ── Step 1: Applicant directory ─────────────────────────────────────────────

print_section "Step 1 — Applicant Directory"
echo "The applicant directory holds your applications, profiles, and base documents."
echo "It is NOT git-tracked (keeps your PII out of version control)."
echo ""

DEFAULT_APPLICANT_DIR="${EXISTING_APPLICANT_DIR:-$(dirname "$REPO_ROOT")/Job-Search-Applicant}"

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

# ── Step 2: PDF generation dependencies ────────────────────────────────────

print_section "Step 2 — PDF Generation Dependencies"

MISSING_DEPS=()
command -v pandoc &>/dev/null  || MISSING_DEPS+=("pandoc (brew install pandoc)")
command -v pdfinfo &>/dev/null || MISSING_DEPS+=("poppler (brew install poppler)")
python3 -c "import weasyprint" &>/dev/null 2>&1 || MISSING_DEPS+=("weasyprint (pip install weasyprint)")

if [[ ${#MISSING_DEPS[@]} -eq 0 ]]; then
    echo "$(green "✓") All dependencies already installed (pandoc, poppler, weasyprint)"
else
    echo "Missing dependencies:"
    for dep in "${MISSING_DEPS[@]}"; do
        echo "  • $dep"
    done
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

# ── Step 3: Google Drive ────────────────────────────────────────────────────

print_section "Step 3 — Google Drive Sync Path"
echo "The applicant directory is synced to Google Drive after every content generation step."
echo ""

# Auto-detect on macOS
DETECTED_GDRIVE=""
if [[ "$(uname)" == "Darwin" ]]; then
    CLOUDSTORE="$HOME/Library/CloudStorage"
    if [[ -d "$CLOUDSTORE" ]]; then
        # Find all GoogleDrive mounts
        mapfile -t GDRIVE_MOUNTS < <(ls "$CLOUDSTORE" 2>/dev/null | grep "^GoogleDrive-")
        if [[ ${#GDRIVE_MOUNTS[@]} -eq 1 ]]; then
            DETECTED_GDRIVE="$CLOUDSTORE/${GDRIVE_MOUNTS[0]}/My Drive/Job Search 2026"
            echo "Detected Google Drive mount: $(yellow "${GDRIVE_MOUNTS[0]}")"
        elif [[ ${#GDRIVE_MOUNTS[@]} -gt 1 ]]; then
            echo "Multiple Google Drive mounts found:"
            for i in "${!GDRIVE_MOUNTS[@]}"; do
                echo "  $((i+1)). ${GDRIVE_MOUNTS[$i]}"
            done
            prompt "Which account number to use?" "1"
            IDX=$(( REPLY - 1 ))
            DETECTED_GDRIVE="$CLOUDSTORE/${GDRIVE_MOUNTS[$IDX]}/My Drive/Job Search 2026"
        fi
    fi
fi

if [[ -z "$DETECTED_GDRIVE" && "$(uname)" == "Darwin" ]]; then
    echo "$(yellow "⚠") Google Drive desktop app not found under ~/Library/CloudStorage."
    echo "  Install it from https://drive.google.com, sign in, and re-run this script."
    echo "  Or enter the path manually below."
fi

DEFAULT_GDRIVE="${EXISTING_GDRIVE_DIR:-${DETECTED_GDRIVE}}"

if [[ -z "$DEFAULT_GDRIVE" ]]; then
    echo "Enter your Google Drive sync folder path."
    echo "See .env.example for Windows/Linux path formats."
fi

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
else
    echo "$(yellow "⚠") No Google Drive path set. You can add it to .env later."
fi

# ── Step 4: Anthropic API key ───────────────────────────────────────────────

print_section "Step 4 — Anthropic API Key"
echo "Used by scripts and Claude Code to call the Anthropic API."
echo ""

if [[ -n "$EXISTING_API_KEY" ]]; then
    MASKED="${EXISTING_API_KEY:0:8}…${EXISTING_API_KEY: -4}"
    echo "Found existing key: $(yellow "$MASKED")"
    if confirm "Use this key?"; then
        ANTHROPIC_API_KEY="$EXISTING_API_KEY"
        echo "$(green "✓") Using existing key"
    else
        printf 'Enter new Anthropic API key: '
        read -rs ANTHROPIC_API_KEY
        echo ""
        echo "$(green "✓") Key set"
    fi
else
    echo "No existing ANTHROPIC_API_KEY found in environment or .env."
    echo "Get your key at https://console.anthropic.com/"
    echo ""
    printf 'Anthropic API key (Enter to skip): '
    read -rs ANTHROPIC_API_KEY
    echo ""
    if [[ -n "$ANTHROPIC_API_KEY" ]]; then
        echo "$(green "✓") Key set"
    else
        echo "$(yellow "⚠") Skipped. Add ANTHROPIC_API_KEY to .env manually if needed."
    fi
fi

# ── Step 5: Write .env ──────────────────────────────────────────────────────

print_section "Step 5 — Writing .env"

cat > "$ENV_FILE" << ENVEOF
# Job Search 2026 — Environment Configuration
# Generated by scripts/setup.sh — gitignored, never commit this file.
# To update, edit this file directly or re-run: bash scripts/setup.sh

export APP_DIR="$REPO_ROOT"
export APPLICANT_DIR="$APPLICANT_DIR"
ENVEOF

if [[ -n "$GDRIVE_DIR" ]]; then
    echo "export GDRIVE_DIR=\"$GDRIVE_DIR\"" >> "$ENV_FILE"
else
    echo "# export GDRIVE_DIR=\"/path/to/gdrive/Job Search 2026\"" >> "$ENV_FILE"
fi

if [[ -n "$ANTHROPIC_API_KEY" ]]; then
    echo "export ANTHROPIC_API_KEY=\"$ANTHROPIC_API_KEY\"" >> "$ENV_FILE"
else
    echo "# export ANTHROPIC_API_KEY=\"sk-ant-...\"" >> "$ENV_FILE"
fi

echo "$(green "✓") Written: $ENV_FILE"

# ── Verification ────────────────────────────────────────────────────────────

print_section "Verification"

# shellcheck disable=SC1090
source "$ENV_FILE"

echo "  APP_DIR       = $APP_DIR"
echo "  APPLICANT_DIR = $APPLICANT_DIR"
if [[ -n "${GDRIVE_DIR:-}" ]]; then
    echo "  GDRIVE_DIR    = $GDRIVE_DIR"
else
    echo "  GDRIVE_DIR    = $(yellow "(not set)")"
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "  ANTHROPIC_API_KEY = ${ANTHROPIC_API_KEY:0:8}…${ANTHROPIC_API_KEY: -4}"
else
    echo "  ANTHROPIC_API_KEY = $(yellow "(not set)")"
fi

if [[ -n "${GDRIVE_DIR:-}" && -d "$APPLICANT_DIR" ]]; then
    echo ""
    echo "Testing rsync dry run…"
    if rsync -a --dry-run --exclude='node_modules' --exclude='_temp-*' \
        "$APPLICANT_DIR/" "$GDRIVE_DIR/" 2>&1 | head -3; then
        echo "$(green "✓") Sync path verified"
    fi
fi

# ── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "$(bold "════════════════════════════════════════════════")"
echo "$(green "Setup complete!")"
echo "$(bold "════════════════════════════════════════════════")"
echo ""
echo "To activate in your current shell:"
echo "  $(bold "source .env")"
echo ""
echo "Next steps (see QUICK-START.md §2–6):"
echo "  2. Create base-documents/EXPERIENCE-REFERENCE.md in \$APPLICANT_DIR"
echo "  3. Define profiles in \$APPLICANT_DIR/profiles/"
echo "  4. Create \$APPLICANT_DIR/applicant.md"
echo "  5. Initialize \$APPLICANT_DIR/application-tracker.md"
echo "  6. Review CLAUDE.md for workflow rules"
echo ""
