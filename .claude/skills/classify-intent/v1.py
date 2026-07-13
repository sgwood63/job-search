#!/usr/bin/env python3
"""
Intent classifier skill — v1.

Reads {"prompt": "..."} from stdin, returns a single intent label to stdout.
Called by classify-intent-before-plan.py hook via subprocess.

Output: one of  repo_evolution | business_operation | escape_hatch | unknown
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 10
TIMEOUT = 15

VALID_LABELS = {"repo_evolution", "business_operation", "escape_hatch", "unknown"}


# ---------------------------------------------------------------------------
# Environment helpers (same pattern as scripts/langfuse_cc_hook.py)
# ---------------------------------------------------------------------------

def _parse_env_file(path: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                line = re.sub(r"^export\s+", "", line)
                m = re.match(r'^([A-Z_][A-Z0-9_]*)=["\']?(.*?)["\']?\s*(?:#.*)?$', line)
                if m:
                    result[m.group(1)] = m.group(2)
    except Exception:
        pass
    return result


def _get_project_root() -> Optional[Path]:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=3,
        )
        if r.returncode == 0:
            return Path(r.stdout.strip())
    except Exception:
        pass
    return None


def _load_env_services(root: Optional[Path]) -> Dict[str, str]:
    if not root:
        return {}
    path = root / ".env.services"
    if not path.exists():
        return {}
    return _parse_env_file(str(path))


def _get_api_key(root: Optional[Path]) -> Optional[str]:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if key:
        return key
    svc = _load_env_services(root)
    key = svc.get("ANTHROPIC_API_DEPLOYMENT_KEY", "").strip()
    return key or None


# ---------------------------------------------------------------------------
# Policy loading
# ---------------------------------------------------------------------------

def _parse_policy_yaml(text: str) -> Optional[dict]:
    """Try PyYAML first; fall back to minimal hand-parser."""
    try:
        import yaml
        return yaml.safe_load(text)
    except ImportError:
        pass
    return _parse_policy_simple(text)


def _parse_policy_simple(text: str) -> Optional[dict]:
    """Minimal parser for the flat intent-policy.yml structure."""
    result: dict = {}
    current_key: Optional[str] = None
    current_sub: Optional[str] = None
    in_list = False

    for line in text.splitlines():
        # Top-level key (no indent, ends with colon)
        m = re.match(r'^([a-z_]+):\s*$', line)
        if m:
            current_key = m.group(1)
            result[current_key] = {}
            current_sub = None
            in_list = False
            continue

        # Sub-key with inline value or inline list
        m = re.match(r'^  ([a-z_]+):\s*(.*)$', line)
        if m and current_key:
            current_sub = m.group(1)
            value = m.group(2).strip()
            if value.startswith('[') and value.endswith(']'):
                items = [x.strip().strip('"\'') for x in value[1:-1].split(',') if x.strip()]
                result[current_key][current_sub] = items
                in_list = False
            elif value:
                result[current_key][current_sub] = value
                in_list = False
            else:
                result[current_key][current_sub] = []
                in_list = True
            continue

        # List item under a sub-key
        m = re.match(r'^    - (.+)$', line)
        if m and current_key and current_sub and in_list:
            entry = result[current_key].setdefault(current_sub, [])
            if isinstance(entry, list):
                entry.append(m.group(1).strip())
            continue

    return result if result else None


def _load_policy(root: Optional[Path]) -> Optional[dict]:
    if not root:
        return None
    policy_path = root / ".claude" / "intent-policy.yml"
    if not policy_path.exists():
        return None
    try:
        return _parse_policy_yaml(policy_path.read_text())
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Classification logic
# ---------------------------------------------------------------------------

def _check_escape_hatch(prompt: str, policy: dict) -> bool:
    hatch = policy.get("escape_hatch", {})
    lower = prompt.lower()
    return any(phrase.lower() in lower for phrase in hatch.get("examples", []))


def _check_command(prompt: str, policy: dict) -> Optional[str]:
    """Deterministic lookup for known slash commands — no LLM call needed."""
    stripped = prompt.strip()
    if not stripped.startswith("/"):
        return None
    # Extract command name: /foo bar → foo;  /codex:rescue args → codex:rescue
    parts = stripped[1:].split()
    command = parts[0].lower() if parts else ""
    if not command:
        return None
    for intent_name, intent_data in policy.items():
        if intent_name == "intents":
            continue
        if command in [c.lower() for c in intent_data.get("commands", [])]:
            return intent_name
    return None  # unknown command → fall through to LLM


def _build_system_prompt(policy: dict) -> str:
    lines = [
        "Classify the following user message into exactly one intent category.",
        "Respond with ONLY the label — no explanation, no extra text.",
        "",
        "Categories:",
    ]
    for name, data in policy.items():
        if name == "intents":
            continue
        desc = data.get("description", "")
        examples = data.get("examples", [])
        lines.append(f"\n{name}: {desc}")
        if examples:
            lines.append("Examples (for reference, not exhaustive):")
            for ex in examples[:6]:
                lines.append(f"  - {ex}")

    lines.append(
        "\nunknown: Use when the message does not clearly fit any of the above categories."
    )
    lines.append(f"\nValid labels: {' | '.join(sorted(VALID_LABELS))}")
    return "\n".join(lines)


def _classify_llm(prompt: str, policy: dict, api_key: str) -> str:
    system = _build_system_prompt(policy)
    body = json.dumps({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = Request(
        ANTHROPIC_API_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read())
            raw = data["content"][0]["text"].strip().lower().replace("-", "_")
            return raw if raw in VALID_LABELS else "unknown"
    except (URLError, KeyError, json.JSONDecodeError, Exception):
        return "unknown"


def classify(prompt: str) -> str:
    root = _get_project_root()
    policy = _load_policy(root)
    if not policy:
        return "unknown"

    # Escape hatch takes priority (user is explicitly bypassing)
    if _check_escape_hatch(prompt, policy):
        return "escape_hatch"

    # Known slash commands → deterministic (no LLM cost)
    command_intent = _check_command(prompt, policy)
    if command_intent is not None:
        return command_intent

    # Unknown command or free-form → classify with Haiku
    api_key = _get_api_key(root)
    if not api_key:
        return "unknown"

    return _classify_llm(prompt, policy, api_key)


def main() -> None:
    try:
        data = json.load(sys.stdin)
        prompt = data.get("prompt", "")
    except Exception:
        print("unknown")
        return
    print(classify(prompt))


if __name__ == "__main__":
    main()
