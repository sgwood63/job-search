"""HermesAdapter — experimental adapter for Nous Research's Hermes Agent.

Spike findings (2026-06-12, hermes-agent.org + github.com/NousResearch/hermes-agent):
Hermes documents only interactive entry points (`hermes`, `hermes gateway`) — no
headless flag analogous to `claude -p` is documented. Skills live as portable
SKILL.md files under ~/.hermes/skills/ (agentskills.io standard).

Until a verified headless invocation exists, this adapter:
- materializes the composed skill prompt as a SKILL.md under $HERMES_HOME/skills/
  (so interactive Hermes can pick it up), and
- executes only when HERMES_HEADLESS_CMD is explicitly configured with a command
  template the user has verified (e.g. a wrapper around Hermes' batch_runner).
  Otherwise health() is False and run_skill raises AdapterUnavailable.

Never the default adapter — selected via RUNTIME_ADAPTER=hermes.
"""

import asyncio
import os
import shlex
import subprocess
from pathlib import Path
from typing import Optional

from .adapter import AdapterUnavailable
from .composer import render_task
from .models import ComposedPrompt, SkillRunRequest, SkillRunResult, new_run_id

SKILL_PREFIX = 'job-search-'


class HermesAdapter:
    name = 'hermes'

    def __init__(self, app_dir: Path, hermes_home: Optional[Path] = None,
                 headless_cmd: Optional[str] = None) -> None:
        self._app_dir = Path(app_dir)
        self._home = Path(hermes_home or os.environ.get('HERMES_HOME', '~/.hermes')).expanduser()
        self._headless_cmd = (headless_cmd if headless_cmd is not None
                              else os.environ.get('HERMES_HEADLESS_CMD', ''))

    def materialize_skill(self, prompt: ComposedPrompt) -> Path:
        """Write the composed prompt as an agentskills-style SKILL.md."""
        skill_dir = self._home / 'skills' / f'{SKILL_PREFIX}{prompt.skill}'
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / 'SKILL.md'
        skill_file.write_text(
            '---\n'
            f'name: {SKILL_PREFIX}{prompt.skill}\n'
            f'description: Job-search {prompt.skill}@{prompt.version} '
            f'(generated from the versioned skill registry — do not edit here)\n'
            '---\n\n'
            f'{prompt.system_prompt}\n'
        )
        return skill_file

    def _build_cmd(self, prompt: ComposedPrompt) -> list[str]:
        return [part.format(skill=f'{SKILL_PREFIX}{prompt.skill}')
                for part in shlex.split(self._headless_cmd)]

    def _run(self, req: SkillRunRequest, prompt: ComposedPrompt) -> SkillRunResult:
        if not self._headless_cmd:
            raise AdapterUnavailable(
                'Hermes has no documented headless invocation. Set HERMES_HEADLESS_CMD '
                'to a verified command template (placeholders: {skill}) to enable this adapter.')
        self.materialize_skill(prompt)
        run_id = new_run_id()
        try:
            proc = subprocess.run(
                self._build_cmd(prompt), input=render_task(req.task),
                capture_output=True, text=True, timeout=req.timeout_s,
                cwd=str(self._app_dir),
            )
        except subprocess.TimeoutExpired:
            return SkillRunResult(run_id=run_id, status='timeout', skill=req.skill,
                                  version=prompt.version, adapter=self.name,
                                  error=f'skill run exceeded {req.timeout_s}s')
        except FileNotFoundError as exc:
            raise AdapterUnavailable(f'HERMES_HEADLESS_CMD binary not found: {exc}')
        status = 'ok' if proc.returncode == 0 else 'error'
        return SkillRunResult(
            run_id=run_id, status=status, skill=req.skill, version=prompt.version,
            adapter=self.name, output_text=proc.stdout.strip(),
            transcript=[{'type': 'raw', 'text': proc.stdout}],
            error=None if status == 'ok' else (proc.stderr.strip() or f'exit {proc.returncode}'),
        )

    async def run_skill(self, req: SkillRunRequest, prompt: ComposedPrompt) -> SkillRunResult:
        return await asyncio.to_thread(self._run, req, prompt)

    async def health(self) -> bool:
        return bool(self._headless_cmd)
