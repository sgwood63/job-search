import asyncio
import json
import os
import re
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
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
    'README.md', 'USER-GUIDE.md', 'QUICK-START.md',
    'applicant-setup.md', 'DEVELOPER-README.md',
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


# ── Session management (subprocess --print mode) ──────────────────────────────

@dataclass
class ChatSession:
    id: str
    label: str
    created_at: float
    status: str              # 'executing' | 'waiting' | 'closed'
    mode: str                # 'execute' | 'plan'
    claude_session_id: Optional[str] = None   # Claude Code session ID for --resume
    messages_structured: list = field(default_factory=list)  # {role, content, ts}
    clients: list = field(default_factory=list)  # connected WebSockets
    current_proc: Any = None  # subprocess.Popen, if a message is running


_sessions: dict[str, ChatSession] = {}
_sessions_lock = threading.Lock()
_loop: Optional[asyncio.AbstractEventLoop] = None


@app.on_event('startup')
async def _on_startup() -> None:
    global _loop
    _loop = asyncio.get_running_loop()


def _broadcast(session: ChatSession, msg: dict) -> None:
    if _loop is None:
        return
    text = json.dumps(msg)
    dead = []
    for ws in list(session.clients):
        try:
            asyncio.run_coroutine_threadsafe(ws.send_text(text), _loop)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in session.clients:
            session.clients.remove(ws)


def _run_message_thread(session: ChatSession, message: str) -> None:
    """Spawn `claude -p --output-format stream-json` for one user message, stream chunks."""
    cmd = [
        'claude', '-p',
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
    ]
    if session.mode == 'plan':
        cmd += ['--permission-mode', 'plan']
    if session.claude_session_id:
        cmd += ['--resume', session.claude_session_id]

    session.status = 'executing'
    _broadcast(session, {'type': 'status', 'status': 'executing'})

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            cwd=str(APP_DIR),
            env={**os.environ},
        )
        session.current_proc = proc
        proc.stdin.write(message)
        proc.stdin.close()

        prev_text = ''
        last_saved_text = None

        for raw_line in proc.stdout:
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                obj = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            # Capture Claude Code session ID for --resume on subsequent messages
            if 'session_id' in obj and not session.claude_session_id:
                session.claude_session_id = obj['session_id']

            if obj.get('type') == 'assistant':
                content_blocks = obj.get('message', {}).get('content', [])
                current_text = ''.join(
                    b.get('text', '') for b in content_blocks if b.get('type') == 'text'
                )
                if not current_text:
                    continue
                if current_text.startswith(prev_text):
                    # Continuing the current segment
                    delta = current_text[len(prev_text):]
                    if delta:
                        _broadcast(session, {'type': 'assistant_chunk', 'content': delta})
                    prev_text = current_text
                else:
                    # New segment started — finalize the previous one
                    if prev_text and prev_text != last_saved_text:
                        seg = {'role': 'assistant', 'content': prev_text, 'ts': time.time()}
                        session.messages_structured.append(seg)
                        _broadcast(session, {'type': 'assistant_message', 'content': prev_text, 'ts': seg['ts']})
                        last_saved_text = prev_text
                    # Begin streaming the new segment from scratch
                    prev_text = current_text
                    _broadcast(session, {'type': 'assistant_chunk', 'content': current_text})

        proc.wait()
    except Exception:
        pass

    # Save and broadcast the final segment
    if prev_text and prev_text != last_saved_text:
        seg = {'role': 'assistant', 'content': prev_text, 'ts': time.time()}
        session.messages_structured.append(seg)
        _broadcast(session, {'type': 'assistant_message', 'content': prev_text, 'ts': seg['ts']})

    if session.status != 'closed':
        session.status = 'waiting'
        _broadcast(session, {'type': 'status', 'status': 'waiting'})
    session.current_proc = None


class CreateSessionBody(BaseModel):
    label: str = ''
    mode: str = 'execute'


@app.post('/api/sessions')
async def create_session(body: CreateSessionBody):
    sid = str(uuid.uuid4())[:8]
    label = body.label or f'Session {len(_sessions) + 1}'
    session = ChatSession(
        id=sid,
        label=label,
        created_at=time.time(),
        status='waiting',
        mode=body.mode,
    )
    with _sessions_lock:
        _sessions[sid] = session
    return {'id': sid, 'label': label, 'status': 'waiting', 'mode': session.mode}


@app.get('/api/sessions')
async def list_sessions():
    with _sessions_lock:
        items = list(_sessions.values())
    items.sort(key=lambda s: s.created_at, reverse=True)
    return [
        {
            'id': s.id,
            'label': s.label,
            'created_at': s.created_at,
            'status': s.status,
            'mode': s.mode,
            'preview': s.messages_structured[-1]['content'][:120] if s.messages_structured else '',
        }
        for s in items
    ]


@app.get('/api/sessions/{session_id}')
async def get_session(session_id: str):
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail='Session not found')
    return {
        'id': session.id,
        'label': session.label,
        'created_at': session.created_at,
        'status': session.status,
        'mode': session.mode,
        'claude_session_id': session.claude_session_id,
        'messages': session.messages_structured,
    }


@app.get('/api/sessions/{session_id}/debug')
async def debug_session(session_id: str):
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail='Session not found')
    return {
        'id': session.id,
        'status': session.status,
        'claude_session_id': session.claude_session_id,
        'proc_alive': session.current_proc is not None and session.current_proc.poll() is None,
        'message_count': len(session.messages_structured),
        'last_message': session.messages_structured[-1] if session.messages_structured else None,
    }


class CloseSessionBody(BaseModel):
    pass


@app.post('/api/sessions/{session_id}/close')
async def close_session(session_id: str):
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail='Session not found')
    session.status = 'closed'
    if session.current_proc:
        try:
            session.current_proc.terminate()
        except Exception:
            pass
        session.current_proc = None
    _broadcast(session, {'type': 'status', 'status': 'closed'})
    return {'ok': True}


@app.websocket('/ws/session/{session_id}')
async def session_ws(websocket: WebSocket, session_id: str):
    session = _sessions.get(session_id)
    if not session:
        await websocket.close(code=4004)
        return
    await websocket.accept()
    session.clients.append(websocket)

    # Replay conversation history on reconnect
    if session.messages_structured:
        await websocket.send_text(json.dumps({'type': 'replay', 'messages': session.messages_structured}))
    # Sessions are always immediately ready (no init phase)
    await websocket.send_text(json.dumps({'type': 'system', 'content': 'ready'}))
    await websocket.send_text(json.dumps({'type': 'status', 'status': session.status}))

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                try:
                    await websocket.send_text(json.dumps({'type': 'ping'}))
                except Exception:
                    break
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get('type') == 'input' and session.status != 'closed':
                text = msg.get('data', '')
                if text and session.status != 'executing':
                    clean_text = text.strip()
                    user_msg = {'role': 'user', 'content': clean_text, 'ts': time.time()}
                    session.messages_structured.append(user_msg)
                    _broadcast(session, {'type': 'user_message', 'content': clean_text})
                    t = threading.Thread(
                        target=_run_message_thread,
                        args=(session, clean_text),
                        daemon=True,
                    )
                    t.start()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in session.clients:
            session.clients.remove(websocket)


# ── Static frontend (production) ──────────────────────────────────────────────

# Serve built frontend in production
frontend_dist = Path(__file__).parent.parent / 'frontend' / 'dist'
if frontend_dist.exists():
    app.mount('/', StaticFiles(directory=frontend_dist, html=True), name='static')
