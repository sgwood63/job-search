"""Runtime audit events — single chokepoint for the phase-4 learning loop.

Today: append JSONL to $APP_DIR/.runtime-events/<date>.jsonl (gitignored).
Phase 4 swaps the backend to a js_audit_events table in OB1 without touching
call sites. Event kinds: skill_run | correction | promotion.
"""

import json
import os
import time
from pathlib import Path
from typing import Any, Optional

EVENT_KINDS = ('skill_run', 'correction', 'promotion')


def record_event(kind: str, payload: dict[str, Any],
                 app_dir: Optional[Path] = None) -> dict[str, Any]:
    if kind not in EVENT_KINDS:
        raise ValueError(f'unknown event kind: {kind!r} (expected one of {EVENT_KINDS})')
    root = Path(app_dir or os.environ.get('APP_DIR', '.')) / '.runtime-events'
    root.mkdir(parents=True, exist_ok=True)
    record = {
        'ts': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'kind': kind,
        **payload,
    }
    path = root / f"{time.strftime('%Y-%m-%d')}.jsonl"
    with path.open('a') as f:
        f.write(json.dumps(record, default=str) + '\n')
    return record
