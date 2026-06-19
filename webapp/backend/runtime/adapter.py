from typing import Protocol, runtime_checkable

from .models import ComposedPrompt, SkillRunRequest, SkillRunResult


class AdapterUnavailable(RuntimeError):
    """Raised when the selected adapter cannot execute (binary missing, unverified, etc.)."""


@runtime_checkable
class AgentAdapter(Protocol):
    name: str

    async def run_skill(self, req: SkillRunRequest, prompt: ComposedPrompt) -> SkillRunResult:
        ...

    async def health(self) -> bool:
        ...
