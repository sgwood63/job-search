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
    [[ -n "$REPLY" ]] || REPLY="$default"
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
echo "  4. Choose storage location for applicant files"
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

if [[ -f "$ENV_FILE" ]]; then
    set +e
    # shellcheck disable=SC1090
    source "$ENV_FILE" 2>/dev/null
    set -e
    EXISTING_APPLICANT_NAME="${APPLICANT_NAME:-}"
    EXISTING_APPLICANT_DIR="${APPLICANT_DIR:-}"
fi

# ── Shared helpers (used by both refresh and new-applicant paths) ───────────

detect_cloud_services() {
    # Populates CLOUD_SERVICES (display names) and CLOUD_PATHS (base paths).
    CLOUD_SERVICES=()
    CLOUD_PATHS=()

    if [[ "$(uname)" == "Darwin" ]]; then
        local cloudstore="$HOME/Library/CloudStorage"
        if [[ -d "$cloudstore" ]]; then
            while IFS= read -r mount; do
                CLOUD_SERVICES+=("Google Drive (${mount#GoogleDrive-})")
                CLOUD_PATHS+=("$cloudstore/$mount/My Drive")
            done < <(ls "$cloudstore" 2>/dev/null | grep "^GoogleDrive-")
            while IFS= read -r mount; do
                CLOUD_SERVICES+=("OneDrive (${mount#OneDrive-})")
                CLOUD_PATHS+=("$cloudstore/$mount")
            done < <(ls "$cloudstore" 2>/dev/null | grep "^OneDrive")
        fi
        local icloud="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
        if [[ -d "$icloud" ]]; then
            CLOUD_SERVICES+=("iCloud Drive")
            CLOUD_PATHS+=("$icloud")
        fi
    else
        [[ -d "$HOME/OneDrive" ]] && CLOUD_SERVICES+=("OneDrive") && CLOUD_PATHS+=("$HOME/OneDrive")
    fi
    [[ -d "$HOME/Dropbox" ]] && CLOUD_SERVICES+=("Dropbox") && CLOUD_PATHS+=("$HOME/Dropbox")
    if [[ -d "$HOME/Box" ]]; then
        CLOUD_SERVICES+=("Box")
        CLOUD_PATHS+=("$HOME/Box")
    elif [[ -d "$HOME/Box Sync" ]]; then
        CLOUD_SERVICES+=("Box")
        CLOUD_PATHS+=("$HOME/Box Sync")
    fi
}

run_deps() {
    print_section "PDF Generation Dependencies"
    local missing=()
    command -v pandoc  &>/dev/null || missing+=("pandoc (brew install pandoc)")
    command -v pdfinfo &>/dev/null || missing+=("poppler (brew install poppler)")

    if [[ ${#missing[@]} -eq 0 ]]; then
        echo "$(green "✓") All dependencies installed (pandoc, poppler)"
    else
        echo "Missing dependencies:"
        for dep in "${missing[@]}"; do echo "  • $dep"; done
        echo ""
        if confirm "Install missing dependencies now?"; then
            command -v pandoc  &>/dev/null || brew install pandoc
            command -v pdfinfo &>/dev/null || brew install poppler
            echo "$(green "✓") Dependencies installed"
        else
            echo "$(yellow "⚠") Skipped. PDF generation will not work until these are installed."
        fi
    fi
}

detect_playwright_python() {
    # Sets PLAYWRIGHT_PYTHON to the first python that has playwright installed.
    # Tries common locations; defaults to "python3" if none found.
    PLAYWRIGHT_PYTHON=""

    local candidates=(
        "/opt/homebrew/anaconda3/bin/python3"
        "/opt/homebrew/bin/python3"
        "/usr/local/bin/python3"
        "$(command -v python3 2>/dev/null || true)"
    )

    for py in "${candidates[@]}"; do
        [[ -z "$py" ]] && continue
        if "$py" -c "import playwright" &>/dev/null 2>&1; then
            PLAYWRIGHT_PYTHON="$py"
            break
        fi
    done

    if [[ -n "$PLAYWRIGHT_PYTHON" ]]; then
        echo "$(green "✓") Playwright found: $PLAYWRIGHT_PYTHON"
    else
        echo "$(yellow "⚠") Playwright not found in common locations."
        echo "  To install:  pip install playwright && playwright install chromium"
        echo "  Then set PLAYWRIGHT_PYTHON in .env to the python path that has it."
        echo "  (fetch-jd.py needs this to fetch job pages that require login.)"
        PLAYWRIGHT_PYTHON="python3"
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

    if $USE_OAUTH; then
        echo "# ANTHROPIC_API_KEY not needed — using Claude Code OAuth" >> "$ENV_FILE"
    elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        echo "export ANTHROPIC_API_KEY=\"${ANTHROPIC_API_KEY}\"" >> "$ENV_FILE"
    else
        echo "# export ANTHROPIC_API_KEY=\"sk-ant-...\"" >> "$ENV_FILE"
    fi

    # Playwright Python — used by scripts/fetch-jd.py to fetch login-walled pages
    cat >> "$ENV_FILE" << ENVEOF

# Python interpreter with Playwright installed (for fetch-jd.py)
# Run: python3 -c "import playwright" — if it fails, find the right python.
# Common locations: /opt/homebrew/anaconda3/bin/python3, /usr/local/bin/python3
export PLAYWRIGHT_PYTHON="${PLAYWRIGHT_PYTHON:-python3}"
ENVEOF

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
    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        echo "  ANTHROPIC_API_KEY = ${ANTHROPIC_API_KEY:0:8}…${ANTHROPIC_API_KEY: -4}"
    else
        echo "  ANTHROPIC_API_KEY = $(yellow "(not set — OAuth active)")"
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

        run_deps
        detect_playwright_python
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

# ── Step 1: PDF Dependencies + Playwright ───────────────────────────────────

run_deps
detect_playwright_python

# ── Step 2: Storage Location ─────────────────────────────────────────────────

print_section "Step 2 — Storage Location"
echo "Choose where applicant files are stored. For a cloud sync service, files are"
echo "placed inside the service's managed local folder and synced automatically by"
echo "the OS — no extra step needed."
echo ""

if [[ "$(uname)" == "Darwin" || "$(uname)" == "Linux" ]]; then
    DOCS_DIR="${XDG_DOCUMENTS_DIR:-$HOME/Documents}"
else
    DOCS_DIR="$HOME/Documents"
fi

DEFAULT_LOCAL="$DOCS_DIR/job-applications"

detect_cloud_services

echo "  1. Local only  ($DEFAULT_LOCAL)"
for i in "${!CLOUD_SERVICES[@]}"; do
    echo "  $((i+2)). ${CLOUD_SERVICES[$i]}  (${CLOUD_PATHS[$i]})"
done
echo ""
prompt "Storage option" "1"
STORAGE_CHOICE="$REPLY"

if [[ "$STORAGE_CHOICE" == "1" || -z "$STORAGE_CHOICE" ]]; then
    prompt "Local storage path" "$DEFAULT_LOCAL"
    APPLICANT_DIR="$REPLY"
else
    idx=$(( STORAGE_CHOICE - 2 ))
    if [[ $idx -lt 0 || $idx -ge ${#CLOUD_SERVICES[@]} ]]; then
        echo "$(yellow "⚠") Invalid choice. Using local default."
        APPLICANT_DIR="$DEFAULT_LOCAL"
    else
        CLOUD_BASE="${CLOUD_PATHS[$idx]}"
        SERVICE_NAME="${CLOUD_SERVICES[$idx]}"
        prompt "Sub-directory name within $SERVICE_NAME" "job-applications"
        APPLICANT_DIR="$CLOUD_BASE/$REPLY"
        echo "  $(green "→") Files will be stored at: $(yellow "$APPLICANT_DIR")"
        echo "  $SERVICE_NAME will sync this folder automatically."
    fi
fi

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

# ── Step 3: Write .env ──────────────────────────────────────────────────────

print_section "Step 3 — Writing .env"
write_env

# ── Step 4: Scaffold applicant directory ────────────────────────────────────

print_section "Step 4 — Applicant Directory Structure"
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

# ── Git hooks ───────────────────────────────────────────────────────────────

bash "$REPO_ROOT/scripts/install-hooks.sh"

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
echo "To fetch job pages that require login (LinkedIn, Greenhouse, etc.):"
echo "  ${PLAYWRIGHT_PYTHON:-python3} scripts/fetch-jd.py --setup '<url>'"
echo "  → opens a browser → log in → press Enter → auth saved for that site"
echo "  Subsequent fetches are headless (Claude does this automatically)."
echo ""
