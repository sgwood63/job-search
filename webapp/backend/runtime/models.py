import time
import uuid
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


def new_run_id() -> str:
    """Time-prefixed unique id — sortable join key for runs/corrections/promotions."""
    return f"{time.strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:8]}"


class SkillRunRequest(BaseModel):
    skill: str
    version: Optional[str] = None        # None → resolve by mode
    mode: Literal['interactive', 'webapp'] = 'webapp'
    task: dict[str, Any] = Field(default_factory=dict)
    timeout_s: int = 600


class Artifact(BaseModel):
    key: str                             # OB1 key or APPLICANT_DIR-relative path
    kind: str = 'file'


class ComposedPrompt(BaseModel):
    system_prompt: str
    skill: str
    version: str
    mode: str
    policies: list[str] = Field(default_factory=list)


class SkillRunResult(BaseModel):
    run_id: str = Field(default_factory=new_run_id)
    status: Literal['ok', 'error', 'timeout']
    skill: str
    version: str                         # version actually executed
    adapter: str
    output_text: str = ''
    artifacts: list[Artifact] = Field(default_factory=list)
    transcript: list[dict] = Field(default_factory=list)
    usage: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
