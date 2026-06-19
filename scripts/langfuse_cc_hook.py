#!/usr/bin/env python3
"""
Claude Code Stop hook — posts session turn telemetry to Langfuse.

Registered in .claude/settings.json under Stop hooks. Called after every
assistant response. Credentials resolved from environment, then .env.services.
Silent no-op when keys are absent. Always exits 0.

Phase tags are auto-detected per turn from the tool_use blocks in the current
response cycle — no manual env var required.

Environment:
  LANGFUSE_PUBLIC_KEY  — project public key (pk-lf-...)
  LANGFUSE_SECRET_KEY  — project secret key (sk-lf-...)
  LANGFUSE_HOST        — Langfuse base URL (default: https://cloud.langfuse.com)
  CC_LANGFUSE_TAGS     — comma-separated extra tags, e.g. "profile:presales-se"
  CC_LANGFUSE_DEBUG    — set to "1" to write debug log to ~/.claude/state/langfuse_cc_hook.log
"""

import base64
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from urllib.error import URLError
from urllib.request import Request, urlopen

DEBUG = os.environ.get("CC_LANGFUSE_DEBUG", "") == "1"
LOG_PATH = os.path.expanduser("~/.claude/state/langfuse_cc_hook.log")

# Skills that represent job-search operational activity
OPERATIONAL_SKILLS = {
    "ingest", "linkedin-ingest", "context", "status",
    "apply", "audit", "interview", "memory",
}
# Skills that represent development/tooling activity
DEVELOPMENT_SKILLS = {
    "code-review", "simplify", "verify", "run",
    "security-review", "init", "update-config",
}
# Bash patterns that signal deployment/infrastructure work
DEPLOYMENT_PATTERNS = [r"kubectl\s", r"docker\s+build", r"docker\s+compose", r"helm\s"]


def _log(msg: str) -> None:
    if not DEBUG:
        return
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a") as f:
            ts = datetime.now(timezone.utc).isoformat()
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass


def _parse_env_file(path: str) -> Dict[str, str]:
    """Minimal parser for export KEY="VALUE" style env files."""
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
    except Exception as exc:
        _log(f"_parse_env_file({path}): {exc}")
    return result


def _load_env_services() -> Dict[str, str]:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=3,
        )
        if r.returncode != 0:
            return {}
        path = os.path.join(r.stdout.strip(), ".env.services")
        if not os.path.exists(path):
            return {}
        return _parse_env_file(path)
    except Exception as exc:
        _log(f"_load_env_services: {exc}")
        return {}


def _get_creds() -> Optional[Tuple[str, str, str]]:
    """Return (public_key, secret_key, host) or None when not configured."""
    pub = os.environ.get("LANGFUSE_PUBLIC_KEY", "")
    sec = os.environ.get("LANGFUSE_SECRET_KEY", "")
    host = os.environ.get("LANGFUSE_HOST", "")

    if not pub or not sec:
        svc = _load_env_services()
        pub = pub or svc.get("LANGFUSE_PUBLIC_KEY", "")
        sec = sec or svc.get("LANGFUSE_SECRET_KEY", "")
        host = host or svc.get("LANGFUSE_HOST", "")

    if not pub or not sec:
        _log("Langfuse keys absent — skipping")
        return None

    return pub, sec, (host or "https://cloud.langfuse.com").rstrip("/")


def _extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _collect_turn_tools(transcript: list) -> List[dict]:
    """
    Collect all tool_use blocks from the current response cycle.

    Walk backward through the transcript: gather tool_use from assistant messages,
    stop when a user message is found with no tool_result blocks (that's the
    original prompt, marking the start of this cycle).
    """
    tools: List[dict] = []
    for msg in reversed(transcript):
        role = msg.get("role", "")
        content = msg.get("content") or []
        if isinstance(content, str):
            content = []
        if role == "assistant":
            tools.extend(
                b for b in content
                if isinstance(b, dict) and b.get("type") == "tool_use"
            )
        elif role == "user":
            has_tool_result = any(
                isinstance(b, dict) and b.get("type") == "tool_result"
                for b in content
            )
            if not has_tool_result:
                break  # original prompt — stop scanning
    return tools


def _classify_tools(tools: List[dict]) -> Tuple[Optional[str], Optional[str]]:
    """
    Return (phase_tag, skill_name) derived from the tool_use blocks for this turn.

    phase_tag is "phase:operations", "phase:development", or None.
    skill_name is the first Skill tool's skill argument, or None.

    Operations signals take priority over development signals when both appear.
    """
    skill_name: Optional[str] = None
    is_operational = False
    is_development = False

    for tool in tools:
        name = tool.get("name", "")
        inp = tool.get("input") or {}

        if name == "Skill":
            skill = inp.get("skill") or inp.get("name") or ""
            if skill_name is None and skill:
                skill_name = skill
            if skill in OPERATIONAL_SKILLS:
                is_operational = True
            elif skill in DEVELOPMENT_SKILLS:
                is_development = True

        elif name.startswith("mcp__job-search__") or name.startswith("mcp__open-brain__"):
            is_operational = True

        elif name == "Bash":
            cmd = inp.get("command", "")
            if any(re.search(p, cmd) for p in DEPLOYMENT_PATTERNS):
                is_development = True

    if is_operational:
        phase: Optional[str] = "phase:operations"
    elif is_development:
        phase = "phase:development"
    else:
        phase = None

    return phase, skill_name


def _build_tags(phase: Optional[str], skill_name: Optional[str]) -> List[str]:
    tags = ["service:claude-code", "project:job-search"]
    if phase:
        tags.append(phase)
    if skill_name:
        tags.append(f"skill:{skill_name}")
    for tag in os.environ.get("CC_LANGFUSE_TAGS", "").split(","):
        tag = tag.strip()
        if tag:
            tags.append(tag)
    return tags


def _post(pub: str, sec: str, host: str, batch: List[dict]) -> None:
    url = f"{host}/api/public/ingestion"
    token = base64.b64encode(f"{pub}:{sec}".encode()).decode()
    body = json.dumps({"batch": batch}).encode()
    req = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Basic {token}"},
        method="POST",
    )
    with urlopen(req, timeout=5) as resp:
        _log(f"POST {url} → {resp.status}")


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        _log("Empty stdin")
        return

    try:
        data = json.loads(raw)
    except Exception as exc:
        _log(f"JSON parse error: {exc}")
        return

    creds = _get_creds()
    if creds is None:
        return
    pub, sec, host = creds

    session_id: str = data.get("session_id") or str(uuid.uuid4())
    model: str = data.get("model", "")
    transcript: list = data.get("transcript") or []

    # Extract the last assistant turn's text + usage, and preceding user prompt.
    user_text = ""
    assistant_text = ""
    usage: dict = {}

    found_assistant = False
    for msg in reversed(transcript):
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not found_assistant and role == "assistant":
            found_assistant = True
            assistant_text = _extract_text(content)[:500]
            model = model or msg.get("model", "")
            usage = msg.get("usage", {})
        elif found_assistant and role == "user":
            text = _extract_text(content)
            if text:
                user_text = text[:500]
                break
            # tool_result-only message — keep scanning for original prompt

    # Classify the turn by what tools were actually called.
    tools = _collect_turn_tools(transcript)
    phase, skill_name = _classify_tools(tools)
    _log(f"session={session_id} phase={phase} skill={skill_name} tools={len(tools)}")

    tags = _build_tags(phase, skill_name)
    now = datetime.now(timezone.utc).isoformat()

    batch = [
        {
            "id": str(uuid.uuid4()),
            "type": "trace-create",
            "timestamp": now,
            "body": {
                "id": session_id,
                "name": "claude-code-session",
                "tags": tags,
            },
        },
        {
            "id": str(uuid.uuid4()),
            "type": "generation-create",
            "timestamp": now,
            "body": {
                "id": str(uuid.uuid4()),
                "traceId": session_id,
                "name": "cc-turn",
                "model": model,
                "input": user_text,
                "output": assistant_text,
                "usage": {
                    "input": usage.get("input_tokens", 0),
                    "output": usage.get("output_tokens", 0),
                    "unit": "TOKENS",
                },
            },
        },
    ]

    try:
        _post(pub, sec, host, batch)
    except (URLError, Exception) as exc:
        _log(f"POST failed: {exc}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        _log(f"Unhandled: {exc}")
    sys.exit(0)
