#!/usr/bin/env python3
"""
UserPromptSubmit hook — thin wrapper around the classify-intent skill.

Responsibilities:
  1. Extract session_id + prompt from the hook payload
  2. Write session_id to ~/.claude/state/current-session-id
  3. Delegate classification to .claude/skills/classify-intent/v1.py
  4. Write the classified intent to ~/.claude/state/current-session-intent
  5. If repo_evolution and no scope marker: print advisory to stderr
  6. Always exit 0 — this hook warns, never blocks
"""
import json
import subprocess
import sys
from pathlib import Path

STATE_DIR = Path.home() / ".claude" / "state"
SESSION_ENV_DIR = Path.home() / ".claude" / "session-env"


def get_scope_marker(session_id: str) -> Path:
    return SESSION_ENV_DIR / session_id / ".large-change-scoped"


def write_state(filename: str, value: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / filename).write_text(value)


def run_classifier(prompt: str, project_root: Path) -> str:
    skill = project_root / ".claude" / "skills" / "classify-intent" / "v1.py"
    if not skill.exists():
        return "unknown"
    try:
        result = subprocess.run(
            ["python3", str(skill)],
            input=json.dumps({"prompt": prompt}),
            capture_output=True, text=True, timeout=20,
        )
        label = result.stdout.strip()
        return label if label else "unknown"
    except Exception:
        return "unknown"


def get_project_root() -> Path:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=3,
        )
        if r.returncode == 0:
            return Path(r.stdout.strip())
    except Exception:
        pass
    return Path.cwd()


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    session_id = payload.get("session_id", "")
    prompt = (
        payload.get("prompt")
        or payload.get("user_prompt")
        or payload.get("message")
        or ""
    )

    if session_id:
        write_state("current-session-id", session_id)

    project_root = get_project_root()
    intent = run_classifier(prompt, project_root)

    write_state("current-session-intent", intent)

    if intent == "repo_evolution" and not get_scope_marker(session_id).exists():
        print(
            "\nThis looks like repository evolution — not a normal job-search operation.\n\n"
            "Before writing any plan or code, run:\n\n"
            "  /large-change-scoping\n\n"
            "The command uses codebase-memory-mcp graph queries (cheap, fast) to map\n"
            "affected files and call chains. At the end it writes a session marker that\n"
            "unblocks APP_DIR writes for the rest of this session.\n\n"
            "Or, if scoping was done externally: 'skip scoping — [your request]'\n",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
