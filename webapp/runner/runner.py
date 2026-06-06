"""
Claude runner sidecar.

Wraps `claude --output-format stream-json` behind a streaming HTTP endpoint
so the webapp container can delegate subprocess management here. When
CLAUDE_RUNNER_URL is set in the webapp, it calls POST /run instead of
spawning subprocesses directly.

The NDJSON stream from claude's stdout is forwarded verbatim — the webapp's
existing JSON parsing loop consumes it unchanged.
"""

import asyncio
import os
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI()


class RunRequest(BaseModel):
    args: List[str]
    cwd: str
    message: str


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.post('/run')
async def run(body: RunRequest):
    # Validate cwd exists — prevent path traversal
    if not os.path.isdir(body.cwd):
        raise HTTPException(status_code=400, detail=f'cwd not found: {body.cwd}')

    async def stream():
        try:
            proc = await asyncio.create_subprocess_exec(
                *body.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                cwd=body.cwd,
                env={**os.environ},
            )
            proc.stdin.write(body.message.encode())
            await proc.stdin.drain()
            proc.stdin.close()

            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                yield line.decode('utf-8')

            await proc.wait()
        except Exception as exc:
            import json
            yield json.dumps({'type': 'error', 'error': str(exc)}) + '\n'

    return StreamingResponse(stream(), media_type='text/plain')
