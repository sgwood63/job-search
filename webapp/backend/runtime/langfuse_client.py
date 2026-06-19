"""Langfuse observability client — singleton wrapper around the Langfuse Python SDK.

All SDK imports are deferred so this module is safe to import when the package
is not installed. When LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY are absent,
is_enabled() returns False and every public function is a no-op.

Interface is FastAPI-free so future Temporal activities in runtime/ can use it
without pulling in webapp dependencies.
"""

import datetime
import os
import sys
from contextlib import contextmanager
from typing import Any, Generator, Optional

# ---------------------------------------------------------------------------
# Configuration — read at import time; restart not required after .env reload
# ---------------------------------------------------------------------------

_HOST = os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com")
_PUBLIC_KEY = os.environ.get("LANGFUSE_PUBLIC_KEY", "")
_SECRET_KEY = os.environ.get("LANGFUSE_SECRET_KEY", "")
_ENABLED = bool(_PUBLIC_KEY and _SECRET_KEY)

_client: Any = None  # lazy singleton


def is_enabled() -> bool:
    """Return True when both Langfuse API keys are present."""
    return _ENABLED


def get_client() -> Any:
    """Return the singleton Langfuse client, or None when disabled."""
    global _client
    if not _ENABLED:
        return None
    if _client is None:
        try:
            from langfuse import Langfuse  # noqa: PLC0415
            _client = Langfuse(
                public_key=_PUBLIC_KEY,
                secret_key=_SECRET_KEY,
                host=_HOST,
            )
        except Exception as exc:
            print(f"[langfuse] init failed: {exc}", file=sys.stderr)
    return _client


# ---------------------------------------------------------------------------
# Span handle — caller mutates model / usage / output during execution
# ---------------------------------------------------------------------------

class _SpanHandle:
    def __init__(self, generation: Any) -> None:
        self._gen = generation
        self._model: Optional[str] = None
        self._usage: dict[str, int] = {}
        self._output: str = ""

    def set_model(self, model: str) -> None:
        self._model = model

    def set_usage(self, *, input: int = 0, output: int = 0) -> None:
        self._usage = {"input": input, "output": output}

    def set_output(self, text: str) -> None:
        self._output = text

    def _close(self) -> None:
        if self._gen is None:
            return
        try:
            kwargs: dict[str, Any] = {}
            if self._model:
                kwargs["model"] = self._model
            if self._usage:
                kwargs["usage"] = {
                    "input": self._usage.get("input", 0),
                    "output": self._usage.get("output", 0),
                    "unit": "TOKENS",
                }
            if self._output:
                kwargs["output"] = self._output[:500]
            self._gen.end(**kwargs)
        except Exception as exc:
            print(f"[langfuse] generation.end failed: {exc}", file=sys.stderr)


class _NoOpHandle:
    """Silent stand-in when Langfuse is disabled or unavailable."""

    def set_model(self, model: str) -> None:
        pass

    def set_usage(self, *, input: int = 0, output: int = 0) -> None:
        pass

    def set_output(self, text: str) -> None:
        pass

    def _close(self) -> None:
        pass


# ---------------------------------------------------------------------------
# Public context manager
# ---------------------------------------------------------------------------

@contextmanager
def span(
    name: str,
    *,
    trace_name: str = "",
    session_id: str = "",
    tags: "list[str] | tuple[str, ...]" = (),
    metadata: Optional[dict] = None,
    input_text: str = "",
) -> "Generator[_SpanHandle | _NoOpHandle, None, None]":
    """Create a Langfuse trace + generation span.

    Yields a handle the caller can use to attach model, usage, and output data
    as they become available (e.g. streaming NDJSON output).

    Example::

        with langfuse_client.span(
            "claude-chat",
            trace_name=session.label,
            session_id=session.id,
            tags=[f"data_backend:{DATA_BACKEND}", f"mode:{session.mode}"],
        ) as gen:
            gen.set_model("claude-opus-4-8")
            gen.set_usage(input=1200, output=340)
    """
    client = get_client()
    if client is None:
        yield _NoOpHandle()
        return

    handle: "_SpanHandle | _NoOpHandle" = _NoOpHandle()
    try:
        trace = client.trace(
            name=trace_name or name,
            session_id=session_id or None,
            tags=list(tags) if tags else None,
            metadata=metadata,
        )
        gen = trace.generation(
            name=name,
            input=input_text[:500] if input_text else None,
        )
        handle = _SpanHandle(gen)
    except Exception as exc:
        print(f"[langfuse] span init failed: {exc}", file=sys.stderr)

    try:
        yield handle
    finally:
        handle._close()


def record_span(
    name: str,
    *,
    duration_ms: int = 0,
    trace_name: str = "",
    tags: "list[str] | tuple[str, ...]" = (),
    metadata: Optional[dict] = None,
    level: str = "DEFAULT",
    status_message: Optional[str] = None,
    input_data: Any = None,
    output_data: Any = None,
) -> None:
    """Fire-and-forget span with an explicit pre-measured duration.

    Use in ASGI middleware or other contexts where you already know the
    elapsed time and don't need a context manager.
    """
    client = get_client()
    if client is None:
        return
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        start = datetime.datetime.fromtimestamp(
            now.timestamp() - duration_ms / 1000, tz=datetime.timezone.utc
        )
        trace = client.trace(
            name=trace_name or name,
            tags=list(tags) if tags else None,
            metadata=metadata,
            input=input_data,
            output=output_data,
        )
        span = trace.span(
            name=name,
            start_time=start,
            end_time=now,
            input=input_data,
            output=output_data,
            metadata={**(metadata or {}), "duration_ms": duration_ms},
            level=level,
            status_message=status_message,
        )
        span.end()
    except Exception as exc:
        print(f"[langfuse] record_span failed: {exc}", file=sys.stderr)


def flush() -> None:
    """Flush all pending Langfuse events. Call at process shutdown."""
    client = get_client()
    if client is None:
        return
    try:
        client.flush()
    except Exception as exc:
        print(f"[langfuse] flush failed: {exc}", file=sys.stderr)
