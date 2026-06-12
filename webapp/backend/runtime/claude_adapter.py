"""ClaudeRunnerAdapter — executes a composed skill prompt via headless Claude Code.

Spawns `claude -p --output-format stream-json` locally (cwd=$APP_DIR), or
forwards to the claude-runner sidecar when a runner URL is configured
(webapp/runner/runner.py — unchanged; it already takes arbitrary args).
"""

import asyncio
import json
import subprocess
import time
from pathlib import Path
from typing import Iterator, Optional

from .adapter import AdapterUnavailable
from .claude_exec import binary_available, resolve_claude_binary, stream_via_runner
from .composer import render_task
from .models import Artifact, ComposedPrompt, SkillRunRequest, SkillRunResult, new_run_id


class SkillRunTimeout(Exception):
    pass


def _extract_artifacts(transcript: list[dict]) -> list[Artifact]:
    """Best-effort artifact list: scan tool calls for OB1 uploads and applicant file writes."""
    artifacts: list[Artifact] = []
    seen: set[str] = set()
    for event in transcript:
        if event.get('type') != 'assistant':
            continue
        for block in event.get('message', {}).get('content', []):
            if block.get('type') != 'tool_use':
                continue
            name = block.get('name', '')
            inp = block.get('input', {}) or {}
            key = None
            if name.endswith('upload_file'):
                key = inp.get('key')
            elif name == 'Write':
                key = inp.get('file_path')
            if key and key not in seen:
                seen.add(key)
                artifacts.append(Artifact(key=str(key)))
    return artifacts


class ClaudeRunnerAdapter:
    name = 'claude-runner'

    def __init__(self, app_dir: Path, env_path: Optional[Path] = None,
                 runner_url: str = '', binary: Optional[str] = None) -> None:
        self._app_dir = Path(app_dir)
        self._env_path = env_path
        self._runner_url = runner_url.rstrip('/')
        self._binary = binary

    def _resolve_binary(self) -> str:
        return self._binary or resolve_claude_binary(env_path=self._env_path,
                                                     runner_url=self._runner_url)

    def _build_cmd(self, prompt: ComposedPrompt) -> list[str]:
        return [
            self._resolve_binary(), '-p',
            '--dangerously-skip-permissions',
            '--output-format', 'stream-json',
            '--verbose',
            '--append-system-prompt', prompt.system_prompt,
        ]

    def iter_events(self, req: SkillRunRequest, prompt: ComposedPrompt) -> Iterator[dict]:
        """Yield parsed stream-json events; raises SkillRunTimeout past req.timeout_s.

        Sync generator on purpose: usable from a thread (run_skill) and directly
        by a StreamingResponse.
        """
        cmd = self._build_cmd(prompt)
        message = render_task(req.task)
        deadline = time.monotonic() + req.timeout_s

        if self._runner_url:
            lines: Iterator[str] = stream_via_runner(
                cmd, message, self._runner_url, str(self._app_dir), timeout=req.timeout_s)
            proc = None
        else:
            if not binary_available(cmd[0]):
                raise AdapterUnavailable(
                    'Claude binary not found. Install Claude Code or set CLAUDE_BINARY in .env.')
            proc = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, cwd=str(self._app_dir),
            )
            proc.stdin.write(message)
            proc.stdin.close()
            lines = proc.stdout

        try:
            for raw in lines:
                if time.monotonic() > deadline:
                    raise SkillRunTimeout(f'skill run exceeded {req.timeout_s}s')
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    yield json.loads(raw)
                except json.JSONDecodeError:
                    continue
        finally:
            if proc is not None and proc.poll() is None:
                proc.kill()

    def run_collected(self, req: SkillRunRequest, prompt: ComposedPrompt) -> SkillRunResult:
        run_id = new_run_id()
        transcript: list[dict] = []
        output_text = ''
        usage: dict = {}
        status = 'error'
        error: Optional[str] = None
        try:
            for event in self.iter_events(req, prompt):
                transcript.append(event)
                if event.get('type') == 'result':
                    output_text = event.get('result') or output_text
                    usage = event.get('usage') or usage
                    if 'total_cost_usd' in event:
                        usage['total_cost_usd'] = event['total_cost_usd']
                    status = 'ok' if event.get('subtype') == 'success' else 'error'
                    if status == 'error':
                        error = event.get('subtype', 'unknown error')
                elif event.get('type') == 'assistant':
                    for block in event.get('message', {}).get('content', []):
                        if block.get('type') == 'text' and block.get('text'):
                            output_text = block['text']
        except SkillRunTimeout as exc:
            status, error = 'timeout', str(exc)
        except AdapterUnavailable:
            raise
        except Exception as exc:
            status, error = 'error', f'{type(exc).__name__}: {exc}'

        return SkillRunResult(
            run_id=run_id, status=status, skill=req.skill, version=prompt.version,
            adapter=self.name, output_text=output_text,
            artifacts=_extract_artifacts(transcript), transcript=transcript,
            usage=usage, error=error,
        )

    async def run_skill(self, req: SkillRunRequest, prompt: ComposedPrompt) -> SkillRunResult:
        return await asyncio.to_thread(self.run_collected, req, prompt)

    async def health(self) -> bool:
        if self._runner_url:
            return True
        return binary_available(self._resolve_binary())
