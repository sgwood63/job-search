import asyncio
import json
import os
import re
import threading
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from tracker import parse_tracker

env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

_raw = os.environ.get('APPLICANT_DIR', '')
APPLICANT_DIR = Path(_raw.strip('"').strip("'"))
if not APPLICANT_DIR.exists():
    raise RuntimeError(f'APPLICANT_DIR does not exist: {APPLICANT_DIR}')

_app_raw = os.environ.get('APP_DIR', '')
APP_DIR = Path(_app_raw.strip('"').strip("'")) if _app_raw else Path(__file__).parent.parent.parent
if not APP_DIR.exists():
    APP_DIR = Path(__file__).parent.parent.parent

DOCS_ALLOWLIST = {
    'README.md', 'QUICK-START.md', 'USER-GUIDE.md',
    'DEVELOPER-README.md', 'workflow.md', 'applicant-setup.md',
}

UPLOAD_ROOTS = [
    APPLICANT_DIR / 'base-documents',
    APPLICANT_DIR / 'applications',
]

app = FastAPI()


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response


app.add_middleware(NoCacheMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    allow_methods=['*'],
    allow_headers=['*'],
)


def safe_resolve(relative_path: str) -> Path:
    resolved = (APPLICANT_DIR / relative_path).resolve()
    if not str(resolved).startswith(str(APPLICANT_DIR.resolve())):
        raise HTTPException(status_code=403, detail='Path traversal not allowed')
    return resolved


def assert_upload_allowed(target_dir: Path) -> None:
    resolved = target_dir.resolve()
    for root in UPLOAD_ROOTS:
        if str(resolved).startswith(str(root.resolve())):
            return
    raise HTTPException(status_code=403, detail='Upload not allowed to this directory')


def build_tree(directory: Path, base: Path) -> list:
    items = []
    try:
        for entry in sorted(directory.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
            if entry.name.startswith('.'):
                continue
            rel = str(entry.relative_to(base))
            if entry.is_dir():
                items.append({
                    'name': entry.name,
                    'path': rel,
                    'type': 'directory',
                    'children': build_tree(entry, base),
                })
            else:
                items.append({
                    'name': entry.name,
                    'path': rel,
                    'type': 'file',
                    'size': entry.stat().st_size,
                })
    except PermissionError:
        pass
    return items


@app.get('/api/tracker')
def get_tracker():
    tracker_path = APPLICANT_DIR / 'application-tracker.md'
    if not tracker_path.exists():
        raise HTTPException(status_code=404, detail='Tracker not found')
    content = tracker_path.read_text(encoding='utf-8')
    return parse_tracker(content, APPLICANT_DIR)


@app.get('/api/root-files')
def get_root_files():
    excluded = {'application-tracker.md', '.env', '.auth', '.DS_Store'}
    files = []
    for entry in sorted(APPLICANT_DIR.iterdir(), key=lambda e: e.name.lower()):
        if entry.is_file() and entry.name not in excluded and not entry.name.startswith('.'):
            files.append({'name': entry.name, 'path': entry.name, 'size': entry.stat().st_size})
    return files


@app.get('/api/profiles')
def get_profiles():
    profiles_dir = APPLICANT_DIR / 'profiles'
    if not profiles_dir.exists():
        return {'profiles': [], 'reference_files': []}
    profiles = []
    reference_files = []
    for entry in sorted(profiles_dir.iterdir(), key=lambda e: e.name):
        if entry.name.startswith('.') or entry.name == 'search-results':
            continue
        if entry.is_dir():
            profiles.append({
                'name': entry.name,
                'path': f'profiles/{entry.name}',
                'files': build_tree(entry, APPLICANT_DIR),
            })
        elif entry.is_file():
            reference_files.append({
                'name': entry.name,
                'path': f'profiles/{entry.name}',
                'type': 'file',
                'size': entry.stat().st_size,
            })
    return {'profiles': profiles, 'reference_files': reference_files}


@app.get('/api/applications')
def get_applications():
    apps_dir = APPLICANT_DIR / 'applications'
    if not apps_dir.exists():
        return []
    return [
        {'name': d.name, 'path': f'applications/{d.name}'}
        for d in sorted(apps_dir.iterdir(), key=lambda e: e.name, reverse=True)
        if d.is_dir() and not d.name.startswith('.')
    ]


@app.get('/api/applications/{folder}')
def get_application(folder: str):
    app_dir = APPLICANT_DIR / 'applications' / folder
    if not app_dir.exists():
        raise HTTPException(status_code=404, detail='Application folder not found')
    return {
        'name': folder,
        'path': f'applications/{folder}',
        'files': build_tree(app_dir, APPLICANT_DIR),
    }


@app.get('/api/base-documents')
def get_base_documents():
    base_dir = APPLICANT_DIR / 'base-documents'
    if not base_dir.exists():
        return []
    return build_tree(base_dir, APPLICANT_DIR)


@app.get('/api/search')
def get_search():
    search_dir = APPLICANT_DIR / 'search'
    if not search_dir.exists():
        return []
    return build_tree(search_dir, APPLICANT_DIR)


@app.get('/api/file')
def get_file(path: str = Query(...)):
    target = safe_resolve(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail='File not found')
    return FileResponse(target)


@app.get('/api/download')
def download_file(path: str = Query(...)):
    target = safe_resolve(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail='File not found')
    return FileResponse(
        target,
        headers={'Content-Disposition': f'attachment; filename="{target.name}"'},
    )


class FileBody(BaseModel):
    content: str


@app.put('/api/file')
def put_file(path: str = Query(...), body: FileBody = None):
    if not path.endswith('.md'):
        raise HTTPException(status_code=400, detail='Only markdown files can be edited')
    target = safe_resolve(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail='File not found')
    target.write_text(body.content, encoding='utf-8')
    return {'ok': True}


@app.post('/api/upload')
async def upload_file(dir: str = Query(...), file: UploadFile = File(...)):
    target_dir = safe_resolve(dir)
    assert_upload_allowed(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / file.filename
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='File too large (max 50 MB)')
    dest.write_bytes(data)
    return {'ok': True, 'path': str(dest.relative_to(APPLICANT_DIR)), 'name': file.filename}


# ── Docs endpoints ────────────────────────────────────────────────────────────

@app.get('/api/docs')
def get_docs():
    docs = []
    for name in sorted(DOCS_ALLOWLIST):
        p = APP_DIR / name
        if p.exists():
            docs.append({'name': name, 'size': p.stat().st_size})
    return docs


@app.get('/api/docs/file')
def get_docs_file(name: str = Query(...)):
    if name not in DOCS_ALLOWLIST:
        raise HTTPException(status_code=403, detail='File not in allowlist')
    p = APP_DIR / name
    if not p.exists():
        raise HTTPException(status_code=404, detail='File not found')
    return FileResponse(p, media_type='text/plain; charset=utf-8')


# ── Setup status ──────────────────────────────────────────────────────────────

@app.get('/api/setup-status')
def get_setup_status():
    status_file = APPLICANT_DIR / 'memory' / 'applicant-setup-status.md'
    if not status_file.exists():
        return {'phases': {p: False for p in 'ABCDEF'}, 'raw': ''}
    content = status_file.read_text(encoding='utf-8')
    phases: dict[str, bool] = {}
    # "Phase A–E (initial setup): Complete" marks A-E all done
    if re.search(r'Phase\s+A[–-]E.*?:\s*(complete|done)', content, re.IGNORECASE):
        for ph in 'ABCDE':
            phases[ph] = True
    else:
        for ph in 'ABCDE':
            phases[ph] = bool(
                re.search(rf'Phase\s+{ph}.*?:\s*(complete|done)', content, re.IGNORECASE) or
                re.search(rf'[✓✅]\s*Phase\s+{ph}', content, re.IGNORECASE)
            )
    phases['F'] = bool(re.search(r'Phase\s+F.*?:\s*active', content, re.IGNORECASE))
    return {'phases': phases, 'raw': content[:800]}


# ── Command launcher (SSE) ────────────────────────────────────────────────────

ALLOWED_COMMAND_PREFIXES = ['/status', '/ingest', '/audit', '/apply', '/memory']


class CommandBody(BaseModel):
    command: str


@app.post('/api/run-command')
async def run_command(body: CommandBody):
    cmd = body.command.strip()
    if not any(cmd.startswith(p) for p in ALLOWED_COMMAND_PREFIXES):
        raise HTTPException(status_code=400, detail='Command not in allowlist')

    async def generate():
        try:
            proc = await asyncio.create_subprocess_exec(
                'claude', '--print', cmd,
                cwd=str(APP_DIR),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env={**os.environ, 'TERM': 'dumb', 'NO_COLOR': '1'},
            )
            async for raw in proc.stdout:
                line = raw.decode('utf-8', errors='replace')
                yield f'data: {json.dumps(line)}\n\n'
            await proc.wait()
        except Exception as e:
            yield f'data: {json.dumps(f"Error: {e}")}\n\n'
        yield 'data: [DONE]\n\n'

    return StreamingResponse(
        generate(),
        media_type='text/event-stream',
        headers={'X-Accel-Buffering': 'no'},
    )


# ── WebSocket terminal (PTY) ──────────────────────────────────────────────────

@app.websocket('/ws/terminal')
async def terminal_ws(websocket: WebSocket):
    await websocket.accept()
    import ptyprocess

    shell = os.environ.get('SHELL', '/bin/zsh')
    proc = ptyprocess.PtyProcessUnicode.spawn(
        [shell],
        cwd=str(APP_DIR),
        dimensions=(24, 220),
    )

    loop = asyncio.get_event_loop()
    stop_event = asyncio.Event()

    def _read_pty():
        while not stop_event.is_set():
            try:
                data = proc.read(1024)
                asyncio.run_coroutine_threadsafe(
                    websocket.send_text(data),
                    loop,
                )
            except Exception:
                break
        asyncio.run_coroutine_threadsafe(stop_event.set(), loop)

    thread = threading.Thread(target=_read_pty, daemon=True)
    thread.start()

    try:
        while not stop_event.is_set():
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=0.1)
                # Check if it's a control message (resize) or terminal input
                try:
                    msg = json.loads(raw)
                    if msg.get('type') == 'resize':
                        cols = int(msg.get('cols', 220))
                        rows = int(msg.get('rows', 24))
                        proc.setwinsize(rows, cols)
                except (json.JSONDecodeError, ValueError):
                    proc.write(raw)
            except asyncio.TimeoutError:
                continue
            except WebSocketDisconnect:
                break
    finally:
        stop_event.set()
        try:
            proc.terminate(force=True)
        except Exception:
            pass


# ── Setup chat (Claude API, SSE) ──────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str


class SetupChatBody(BaseModel):
    phase: str
    messages: list[ChatMessage]


def _load_context_file(path: Path, label: str, max_chars: int = 4000) -> str:
    if not path.exists():
        return ''
    text = path.read_text(encoding='utf-8')[:max_chars]
    return f'\n\n--- {label} ---\n{text}'


@app.post('/api/setup-chat')
async def setup_chat(body: SetupChatBody):
    api_key = os.environ.get('ANTHROPIC_API_KEY', '')

    ctx = ''
    ctx += _load_context_file(APP_DIR / 'CLAUDE.md', 'CLAUDE.md (system instructions)', 6000)
    ctx += _load_context_file(APPLICANT_DIR / 'applicant.md', 'applicant.md', 3000)
    ctx += _load_context_file(APPLICANT_DIR / 'memory' / 'APPLICANT-MEMORY.md', 'APPLICANT-MEMORY.md', 3000)
    ctx += _load_context_file(APPLICANT_DIR / 'memory' / 'applicant-setup-status.md', 'applicant-setup-status.md', 2000)

    system_text = (
        'You are Claude Code, running the Job Search 2026 assistant. '
        f'You are helping with Phase {body.phase} of the applicant setup workflow. '
        'Keep your response focused on this phase only. '
        'Be concise and guide the user step by step.\n\n'
        f'Context loaded from the applicant directory:{ctx}'
    )

    if api_key:
        # API key path: use Anthropic SDK with token-by-token streaming
        import anthropic

        messages = [{'role': m.role, 'content': m.content} for m in body.messages]
        if not messages:
            messages = [{'role': 'user', 'content': f'/setup {body.phase}'}]

        client = anthropic.Anthropic(api_key=api_key)

        async def generate_sdk():
            try:
                with client.messages.stream(
                    model='claude-sonnet-4-6',
                    max_tokens=2048,
                    system=system_text,
                    messages=messages,
                ) as stream:
                    for text in stream.text_stream:
                        yield f'data: {json.dumps(text)}\n\n'
            except Exception as e:
                yield f'data: {json.dumps(f"Error: {e}")}\n\n'
            yield 'data: [DONE]\n\n'

        return StreamingResponse(
            generate_sdk(),
            media_type='text/event-stream',
            headers={'X-Accel-Buffering': 'no'},
        )

    else:
        # OAuth path: use claude CLI binary (same auth as /api/run-command)
        msgs = body.messages or [type('M', (), {'role': 'user', 'content': f'/setup {body.phase}'})()]
        conv_parts = [
            ('User' if m.role == 'user' else 'Assistant') + ': ' + m.content
            for m in msgs[:-1]
        ]
        prompt = ('\n'.join(conv_parts) + '\nUser: ' if conv_parts else '') + msgs[-1].content

        async def generate_cli():
            try:
                proc = await asyncio.create_subprocess_exec(
                    'claude', '--print', prompt,
                    '--append-system-prompt', system_text,
                    cwd=str(APP_DIR),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env={**os.environ, 'TERM': 'dumb', 'NO_COLOR': '1'},
                )
                async for raw in proc.stdout:
                    yield f'data: {json.dumps(raw.decode("utf-8", errors="replace"))}\n\n'
                await proc.wait()
            except Exception as e:
                yield f'data: {json.dumps(f"Error: {e}")}\n\n'
            yield 'data: [DONE]\n\n'

        return StreamingResponse(
            generate_cli(),
            media_type='text/event-stream',
            headers={'X-Accel-Buffering': 'no'},
        )


# ── Static frontend (production) ──────────────────────────────────────────────

# Serve built frontend in production
frontend_dist = Path(__file__).parent.parent / 'frontend' / 'dist'
if frontend_dist.exists():
    app.mount('/', StaticFiles(directory=frontend_dist, html=True), name='static')
