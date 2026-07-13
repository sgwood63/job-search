#!/usr/bin/env python3
"""
PreToolUse hook for Write | Edit | MultiEdit — intent-driven write routing.

Reads the current session intent from ~/.claude/state/current-session-intent
and gates APP_DIR writes accordingly. No hardcoded path matching.

Intent routing:
  repo_evolution   → allow if scope marker exists; block otherwise
  business_operation → block writes inside the project repo (APP_DIR)
  escape_hatch     → allow all
  unknown / absent → fallback: allow if session marker OR old shared marker exists
"""
import json
import subprocess
import sys
from pathlib import Path

STATE_DIR = Path.home() / ".claude" / "state"
SESSION_ENV_DIR = Path.home() / ".claude" / "session-env"

# Transition fallback — old shared marker pre-session-scoped design.
# Safe to delete once all sessions use the new per-session marker.
OLD_MARKER = Path.cwd() / ".claude" / ".large-change-scoped"


def read_state(filename: str) -> str:
    f = STATE_DIR / filename
    return f.read_text().strip() if f.exists() else ""


def get_session_marker() -> Path | None:
    session_id = read_state("current-session-id")
    if not session_id:
        return None
    return SESSION_ENV_DIR / session_id / ".large-change-scoped"


def is_repo_path(file_path: str) -> bool:
    """Returns True if file_path is inside the git project root (APP_DIR)."""
    if not file_path:
        return False
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=3,
        )
        if r.returncode != 0:
            return False
        project_root = Path(r.stdout.strip()).resolve()
        Path(file_path).resolve().relative_to(project_root)
        return True
    except (ValueError, Exception):
        return False


def get_file_path(payload: dict) -> str:
    tool_input = payload.get("tool_input", {})
    return (
        tool_input.get("file_path")
        or tool_input.get("path")
        or ""
    )


def block(msg: str) -> int:
    print(msg, file=sys.stderr)
    return 2


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    intent = read_state("current-session-intent")
    file_path = get_file_path(payload)

    if intent == "repo_evolution":
        marker = get_session_marker()
        if marker and marker.exists():
            return 0
        if not is_repo_path(file_path):
            return 0
        return block(
            "\nBlocked: session classified as repo_evolution but no scope marker exists.\n\n"
            "Run /large-change-scoping to map the change with codebase-memory-mcp,\n"
            "then it will write the session marker automatically.\n"
        )

    if intent == "business_operation":
        if is_repo_path(file_path):
            return block(
                "\nBlocked: session classified as business_operation but this write\n"
                "targets the project repo (APP_DIR).\n\n"
                "If this is intentional repo work, start with /large-change-scoping.\n"
                "Or use 'skip scoping — [request]' to bypass for this message.\n"
            )
        return 0

    if intent in ("escape_hatch",):
        return 0

    # intent == "unknown" or state file absent — fallback to marker check
    marker = get_session_marker()
    if marker and marker.exists():
        return 0
    if OLD_MARKER.exists():
        return 0

    # No intent, no marker — block repo paths only (safe default)
    if is_repo_path(file_path):
        return block(
            "\nBlocked: no session intent or scope marker found.\n\n"
            "Run /large-change-scoping for repo-evolution work, or start a new\n"
            "session so the intent classifier can detect your session type.\n"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
