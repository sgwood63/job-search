"""Claude binary resolution and runner-sidecar streaming.

Extracted from main.py so the runtime package (and phase-3 Temporal workers)
can execute headless Claude without importing FastAPI. main.py imports these
back for the chat path — behavior unchanged.
"""

import glob
import json
import os
import re
import shutil
from pathlib import Path
from typing import Iterator, Optional

try:
    from dotenv import load_dotenv
except ImportError:                      # pragma: no cover — dotenv is a backend dep
    load_dotenv = None


def resolve_claude_binary(env_path: Optional[Path] = None, runner_url: str = '') -> str:
    """Return the best available Claude binary path.

    When runner_url is set (container/runner mode), the cmd is forwarded
    to the runner sidecar which executes it inside its own container — never
    send a local VS Code extension path there.

    Local mode priority:
      1. CLAUDE_BINARY env var if set and the file exists (explicit pin / fallback)
      2. Latest VS Code extension binary, auto-discovered by semver
      3. System PATH 'claude'
    """
    if load_dotenv and env_path:
        load_dotenv(env_path, override=True)
    explicit = os.environ.get('CLAUDE_BINARY', '')

    if runner_url:
        return explicit or 'claude'

    if explicit and os.path.isfile(explicit):
        return explicit

    candidates = glob.glob(os.path.expanduser(
        '~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude'
    ))
    if candidates:
        def _ver(path: str):
            m = re.search(r'claude-code-(\d+)\.(\d+)\.(\d+)', path)
            return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else (0, 0, 0)
        candidates.sort(key=_ver, reverse=True)
        return candidates[0]

    return shutil.which('claude') or 'claude'


def stream_via_runner(cmd: list, message: str, runner_url: str, cwd: str,
                      timeout: int = 300) -> Iterator[str]:
    """Call the claude-runner sidecar and yield NDJSON lines from its streaming response."""
    import http.client
    import urllib.parse
    parsed = urllib.parse.urlparse(runner_url)
    body = json.dumps({'args': cmd, 'cwd': cwd, 'message': message}).encode()
    conn = http.client.HTTPConnection(parsed.netloc, timeout=timeout)
    try:
        conn.request('POST', (parsed.path or '') + '/run', body,
                     {'Content-Type': 'application/json'})
        resp = conn.getresponse()
        for raw in resp:
            yield raw.decode('utf-8')
    finally:
        conn.close()


def binary_available(binary: str) -> bool:
    return bool(shutil.which(binary)) or os.path.isfile(binary)
