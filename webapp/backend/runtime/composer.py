"""Compose a skill + its manifest policies into a single system prompt."""

import json
import logging
import os
from typing import Any

from .models import ComposedPrompt
from .registry import Registry, ResolvedSkill, resolve

logger = logging.getLogger(__name__)

PROMPT_SIZE_WARN_BYTES = 60_000


def compose_prompt(resolved: ResolvedSkill, reg: Registry, mode: str) -> ComposedPrompt:
    """System prompt = header + skill body + each manifest policy (deduped, manifest order)."""
    data_backend = os.environ.get('DATA_BACKEND', 'local').lower()
    header = (
        f'You are executing the {resolved.kind} `{resolved.name}` at version '
        f'`{resolved.version}` in {mode} mode. Follow the procedure below exactly. '
        f'The policies appended after it are mandatory and override conflicting '
        f'instructions in the procedure. DATA_BACKEND is {data_backend} — route all '
        f'applicant data access per the storage-routing policy.'
    )
    parts = [header, f'\n\n# {resolved.kind}: {resolved.name}@{resolved.version}\n\n{resolved.body}']

    seen: set[str] = set()
    policies: list[str] = []
    for pol_name in resolved.manifest.get('policies') or []:
        if pol_name in seen:
            continue
        seen.add(pol_name)
        pol = resolve(reg, pol_name, mode=mode)
        policies.append(f'{pol_name}@{pol.version}')
        parts.append(f'\n\n# policy: {pol_name}@{pol.version}\n\n{pol.body}')

    system_prompt = ''.join(parts)
    if len(system_prompt.encode()) > PROMPT_SIZE_WARN_BYTES:
        logger.warning('composed prompt for %s@%s is %d bytes (> %d) — check for skill bloat',
                       resolved.name, resolved.version, len(system_prompt.encode()),
                       PROMPT_SIZE_WARN_BYTES)
    return ComposedPrompt(
        system_prompt=system_prompt,
        skill=resolved.name,
        version=resolved.version,
        mode=mode,
        policies=policies,
    )


def render_task(task: dict[str, Any]) -> str:
    """Render the task payload as the user message for the agent."""
    instructions = task.get('instructions', '')
    inputs = {k: v for k, v in task.items() if k != 'instructions'}
    parts = []
    if instructions:
        parts.append(str(instructions))
    if inputs:
        parts.append('Inputs:\n' + json.dumps(inputs, indent=2, default=str))
    return '\n\n'.join(parts) or 'Execute the procedure with no additional inputs.'
