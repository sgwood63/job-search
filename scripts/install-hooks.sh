#!/usr/bin/env bash
# install-hooks.sh — install git hooks for this repo
# Run once after cloning: bash scripts/install-hooks.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/usr/bin/env bash
bash "$(git rev-parse --show-toplevel)/scripts/check-md-hygiene.sh"
HOOK

chmod +x "$HOOKS_DIR/pre-commit"
echo "Installed: .git/hooks/pre-commit → scripts/check-md-hygiene.sh"
