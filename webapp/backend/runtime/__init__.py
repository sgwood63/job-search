"""Agent runtime: versioned-skill resolution, prompt composition, and adapters.

This package must stay importable outside FastAPI (phase-3 Temporal workers
import it directly): stdlib + pydantic + yaml + httpx/dotenv only — never
import main.py or fastapi from here.
"""

from .models import Artifact, ComposedPrompt, SkillRunRequest, SkillRunResult
from .registry import Registry, RegistryError, ResolvedSkill, load_registry, resolve
from .composer import compose_prompt, render_task
from .adapter import AdapterUnavailable, AgentAdapter
from .events import record_event

__all__ = [
    'Artifact', 'ComposedPrompt', 'SkillRunRequest', 'SkillRunResult',
    'Registry', 'RegistryError', 'ResolvedSkill', 'load_registry', 'resolve',
    'compose_prompt', 'render_task',
    'AdapterUnavailable', 'AgentAdapter',
    'record_event',
]
