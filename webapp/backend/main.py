import asyncio
import json
import mimetypes
import os
import re
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
import asyncpg
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from storage import make_store

env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

_app_raw = os.environ.get('APP_DIR', '')
APP_DIR = Path(_app_raw.strip('"').strip("'")) if _app_raw else Path(__file__).parent.parent.parent

_applicant_raw = os.environ.get('APPLICANT_DIR', '')
APPLICANT_DIR = Path(_applicant_raw.strip('"').strip("'")) if _applicant_raw else None

DATA_BACKEND = os.environ.get('DATA_BACKEND', 'local').lower()

DOCS_ALLOWLIST = {
    'README.md', 'USER-GUIDE.md', 'QUICK-START.md',
    'applicant-setup.md', 'DEVELOPER-README.md',
}

ALLOWED_UPLOAD_PREFIXES = ('applications/', 'base-documents/')

store = make_store()
_pool: asyncpg.Pool | None = None

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_key(key: str) -> str:
    if '..' in key or key.startswith('/'):
        raise HTTPException(status_code=403, detail='Invalid file key')
    return key


def _validate_upload_key(key: str) -> str:
    _validate_key(key)
    if not any(key.startswith(p) for p in ALLOWED_UPLOAD_PREFIXES):
        raise HTTPException(status_code=403, detail='Upload not allowed to this path')
    return key


def _require_pool() -> asyncpg.Pool:
    if _pool is None:
        raise HTTPException(status_code=503, detail='Database not ready')
    return _pool


def _rows_to_tree(rows: list[dict]) -> list[dict]:
    """Convert a flat list of {key, content_type, size} into a nested tree."""
    tree: dict = {}
    for row in rows:
        key: str = row['key'] if isinstance(row, dict) else row['storage_key']
        parts = key.split('/')
        node = tree
        for part in parts[:-1]:
            node = node.setdefault(part, {'_type': 'directory', '_children': {}})['_children']
        node[parts[-1]] = {
            'name': parts[-1],
            'path': key,
            'type': 'file',
            'size': row.get('size') or row.get('file_size') or 0,
        }

    def _flatten(d: dict) -> list:
        out = []
        for name, val in sorted(d.items()):
            if val.get('_type') == 'directory':
                out.append({'name': name, 'path': name, 'type': 'directory',
                            'children': _flatten(val['_children'])})
            else:
                out.append(val)
        return out

    return _flatten(tree)


# ---------------------------------------------------------------------------
# Local-filesystem helpers (DATA_BACKEND=local)
# ---------------------------------------------------------------------------

def _local_scan(rel_prefix: str) -> list[dict]:
    """Return [{key, size}] for all files under APPLICANT_DIR/rel_prefix."""
    if not APPLICANT_DIR:
        return []
    base = APPLICANT_DIR / rel_prefix
    if not base.exists():
        return []
    results = []
    for p in sorted(base.rglob('*')):
        if p.is_file() and not p.name.startswith('.'):
            results.append({'key': str(p.relative_to(APPLICANT_DIR)), 'size': p.stat().st_size})
    return results


def _local_tracker() -> dict:
    from tracker import parse_tracker
    if not APPLICANT_DIR:
        return {'active': [], 'phase_d': [], 'closed': []}
    tracker_path = APPLICANT_DIR / 'application-tracker.md'
    if not tracker_path.exists():
        return {'active': [], 'phase_d': [], 'closed': []}
    content = tracker_path.read_text(encoding='utf-8')
    parsed = parse_tracker(content, APPLICANT_DIR)

    def _norm_active(r: dict) -> dict:
        return {
            'id': '',
            'company': r.get('company', ''),
            'role': r.get('role', ''),
            'profile': r.get('profile', ''),
            'status': r.get('status', ''),
            'status_detail': r.get('status_detail', ''),
            'applied_date': r.get('date', ''),
            'follow_up_date': r.get('next_action', ''),
            'next_interview_at': '',
            'priority': r.get('priority', ''),
            'source_url': r.get('source', ''),
            'folder': r.get('folder') or '',
        }

    def _norm_closed(r: dict) -> dict:
        return {
            'id': '',
            'company': r.get('company', ''),
            'role': r.get('role', ''),
            'profile': r.get('profile', ''),
            'status': 'closed',
            'status_detail': r.get('status_detail', '') or r.get('notes', ''),
            'applied_date': r.get('date', ''),
            'follow_up_date': '',
            'next_interview_at': '',
            'priority': '',
            'source_url': '',
            'folder': r.get('folder') or '',
        }

    return {
        'active': [_norm_active(r) for r in parsed.get('active', [])],
        'phase_d': [_norm_active(r) for r in parsed.get('phase_d', [])],
        'closed': [_norm_closed(r) for r in parsed.get('closed', [])],
    }


# ---------------------------------------------------------------------------
# Tracker
# ---------------------------------------------------------------------------

@app.get('/api/tracker')
async def get_tracker():
    if DATA_BACKEND != 'ob1':
        return await asyncio.get_event_loop().run_in_executor(None, _local_tracker)

    pool = _require_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT a.id, a.role_title, a.status, a.status_detail,
                   a.applied_date, a.follow_up_date, a.priority,
                   a.source_url, a.folder_prefix, a.resume_key,
                   COALESCE(c.name, a.company_name_raw) AS company,
                   p.slug AS profile,
                   (SELECT MIN(i.scheduled_at)
                    FROM js_interviews i
                    WHERE i.application_id = a.id
                      AND i.scheduled_at >= NOW()
                      AND i.completed_at IS NULL
                   ) AS next_interview_at
            FROM js_applications a
            LEFT JOIN js_companies c ON a.company_id = c.id
            LEFT JOIN js_profiles p ON a.profile_id = p.id
            ORDER BY a.priority DESC, a.created_at DESC
        """)

    active, phase_d, closed = [], [], []
    for r in rows:
        entry = {
            'id': str(r['id']),
            'company': r['company'] or '',
            'role': r['role_title'],
            'profile': r['profile'] or '',
            'status': r['status'],
            'status_detail': r['status_detail'] or '',
            'applied_date': r['applied_date'].isoformat() if r['applied_date'] else '',
            'follow_up_date': r['follow_up_date'].isoformat() if r['follow_up_date'] else '',
            'next_interview_at': r['next_interview_at'].isoformat() if r['next_interview_at'] else '',
            'priority': {3: '⭐⭐⭐', 2: '⭐⭐', 1: ''}.get(r['priority'], ''),
            'source_url': r['source_url'] or '',
            'folder': (r['folder_prefix'] or '').removeprefix('applications/').rstrip('/'),
        }
        if r['status'] == 'closed':
            closed.append(entry)
        elif r['status'] in ('interview-scheduled', 'interviewed', 'exercise', 'offer'):
            phase_d.append(entry)
        else:
            active.append(entry)
    return {'active': active, 'phase_d': phase_d, 'closed': closed}


# ---------------------------------------------------------------------------
# File listing endpoints
# ---------------------------------------------------------------------------

@app.get('/api/root-files')
async def get_root_files():
    if DATA_BACKEND != 'ob1':
        rows = await asyncio.to_thread(lambda: _local_scan(''))
        return [r for r in rows if '/' not in r['key']]

    async with _require_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT storage_key AS key, file_size AS size FROM js_files "
            "WHERE storage_key NOT LIKE '%/%' ORDER BY storage_key"
        )
    return [{'name': r['key'], 'path': r['key'], 'size': r['size']} for r in rows]


@app.get('/api/profiles')
async def get_profiles():
    if DATA_BACKEND != 'ob1':
        file_rows = await asyncio.to_thread(lambda: _local_scan('profiles'))
        profile_names = sorted({
            r['key'].split('/')[1]
            for r in file_rows if r['key'].count('/') >= 2
        })
        profiles = []
        for name in profile_names:
            prefix = f'profiles/{name}/'
            files = [r for r in file_rows if r['key'].startswith(prefix)]
            profiles.append({
                'name': name,
                'display_name': name.replace('-', ' ').title(),
                'path': f'profiles/{name}',
                'files': _rows_to_tree(files),
            })
        reference_files = [
            {'name': r['key'].split('/')[-1], 'path': r['key'], 'type': 'file', 'size': r['size']}
            for r in file_rows if r['key'].count('/') == 1
        ]
        return {'profiles': profiles, 'reference_files': reference_files}

    async with _require_pool().acquire() as conn:
        profile_rows = await conn.fetch(
            "SELECT slug, display_name FROM js_profiles WHERE active ORDER BY slug"
        )
        file_rows = await conn.fetch(
            "SELECT storage_key AS key, content_type, file_size AS size "
            "FROM js_files WHERE storage_key LIKE 'profiles/%' ORDER BY storage_key"
        )

    profiles = []
    for p in profile_rows:
        prefix = f"profiles/{p['slug']}/"
        files = [dict(r) for r in file_rows if r['key'].startswith(prefix)]
        profiles.append({
            'name': p['slug'],
            'display_name': p['display_name'],
            'path': f"profiles/{p['slug']}",
            'files': _rows_to_tree(files),
        })
    reference_files = [
        {'name': r['key'].split('/')[-1], 'path': r['key'], 'type': 'file', 'size': r['size']}
        for r in file_rows if r['key'].count('/') == 1
    ]
    return {'profiles': profiles, 'reference_files': reference_files}


@app.get('/api/applications')
async def get_applications():
    if DATA_BACKEND != 'ob1':
        if not APPLICANT_DIR:
            return []
        apps_dir = APPLICANT_DIR / 'applications'
        if not apps_dir.exists():
            return []
        folders = await asyncio.to_thread(lambda: sorted(
            [d.name for d in apps_dir.iterdir() if d.is_dir() and not d.name.startswith('.')],
            reverse=True,
        ))
        return [{'name': name, 'path': f'applications/{name}'} for name in folders]

    async with _require_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT folder_prefix FROM js_applications "
            "WHERE folder_prefix IS NOT NULL "
            "ORDER BY created_at DESC"
        )
    return [
        {
            'name': r['folder_prefix'].removeprefix('applications/').rstrip('/'),
            'path': r['folder_prefix'].rstrip('/'),
        }
        for r in rows
    ]


@app.get('/api/applications/{folder}')
async def get_application(folder: str):
    prefix = f'applications/{folder}/'
    if DATA_BACKEND != 'ob1':
        rows = await asyncio.to_thread(lambda: _local_scan(f'applications/{folder}'))
        if not rows:
            raise HTTPException(status_code=404, detail='Application folder not found')
        return {'name': folder, 'path': f'applications/{folder}', 'files': _rows_to_tree(rows)}

    async with _require_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT storage_key AS key, content_type, file_size AS size "
            "FROM js_files WHERE storage_key LIKE $1 ORDER BY storage_key",
            prefix + '%',
        )
    if not rows:
        raise HTTPException(status_code=404, detail='Application folder not found')
    return {
        'name': folder,
        'path': f'applications/{folder}',
        'files': _rows_to_tree([dict(r) for r in rows]),
    }


@app.get('/api/base-documents')
async def get_base_documents():
    if DATA_BACKEND != 'ob1':
        rows = await asyncio.to_thread(lambda: _local_scan('base-documents'))
        return _rows_to_tree(rows)

    async with _require_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT storage_key AS key, content_type, file_size AS size "
            "FROM js_files WHERE storage_key LIKE 'base-documents/%' ORDER BY storage_key"
        )
    return _rows_to_tree([dict(r) for r in rows])


@app.get('/api/search')
async def get_search():
    if DATA_BACKEND != 'ob1':
        rows = await asyncio.to_thread(lambda: _local_scan('search'))
        return _rows_to_tree(rows)

    async with _require_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT storage_key AS key, content_type, file_size AS size "
            "FROM js_files WHERE storage_key LIKE 'search/%' ORDER BY storage_key"
        )
    return _rows_to_tree([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# File read / write / upload / download
# ---------------------------------------------------------------------------

@app.get('/api/file')
async def get_file(path: str = Query(...)):
    key = _validate_key(path)
    try:
        content = await store.get(key)
        mime = mimetypes.guess_type(key)[0] or 'application/octet-stream'
        return Response(content, media_type=mime)
    except Exception:
        raise HTTPException(status_code=404, detail='File not found')


@app.get('/api/download')
async def download_file(path: str = Query(...)):
    key = _validate_key(path)
    try:
        content = await store.get(key)
        mime = mimetypes.guess_type(key)[0] or 'application/octet-stream'
        filename = key.split('/')[-1]
        return Response(
            content,
            media_type=mime,
            headers={'Content-Disposition': f'attachment; filename="{filename}"'},
        )
    except Exception:
        raise HTTPException(status_code=404, detail='File not found')


class FileBody(BaseModel):
    content: str


@app.put('/api/file')
async def put_file(path: str = Query(...), body: FileBody = None):
    if not path.endswith('.md'):
        raise HTTPException(status_code=400, detail='Only markdown files can be edited')
    key = _validate_key(path)
    content_bytes = body.content.encode('utf-8')
    await store.put(key, content_bytes, 'text/markdown')
    if DATA_BACKEND == 'ob1':
        async with _require_pool().acquire() as conn:
            await conn.execute(
                """INSERT INTO js_files (storage_key, bucket, content_type, file_size)
                   VALUES ($1, $2, 'text/markdown', $3)
                   ON CONFLICT (storage_key) DO UPDATE SET
                     file_size = EXCLUDED.file_size, updated_at = now()""",
                key,
                os.environ.get('MINIO_BUCKET') or os.environ.get('SUPABASE_BUCKET', 'job-search'),
                len(content_bytes),
            )
    return {'ok': True}


@app.post('/api/upload')
async def upload_file(dir: str = Query(...), file: UploadFile = File(...)):
    key = _validate_upload_key(f"{dir.rstrip('/')}/{file.filename}")
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='File too large (max 50 MB)')
    mime = mimetypes.guess_type(file.filename)[0] or 'application/octet-stream'
    await store.put(key, data, mime)
    if DATA_BACKEND == 'ob1':
        bucket = os.environ.get('MINIO_BUCKET') or os.environ.get('SUPABASE_BUCKET', 'job-search')
        async with _require_pool().acquire() as conn:
            await conn.execute(
                """INSERT INTO js_files (storage_key, bucket, content_type, file_size)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (storage_key) DO UPDATE SET
                     content_type = EXCLUDED.content_type,
                     file_size = EXCLUDED.file_size, updated_at = now()""",
                key, bucket, mime, len(data),
            )
    return {'ok': True, 'path': key, 'name': file.filename}


# ── Docs endpoints ────────────────────────────────────────────────────────────

@app.get('/api/docs')
async def get_docs():
    if DATA_BACKEND != 'ob1':
        results = []
        for name in sorted(DOCS_ALLOWLIST):
            path = APP_DIR / name
            if path.exists():
                results.append({'name': name, 'size': path.stat().st_size})
        return results

    async with _require_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT storage_key AS key, file_size AS size "
            "FROM js_files WHERE storage_key LIKE 'docs/%' ORDER BY storage_key"
        )
    return [
        {'name': r['key'].replace('docs/', ''), 'size': r['size']}
        for r in rows
        if r['key'].replace('docs/', '') in DOCS_ALLOWLIST
    ]


@app.get('/api/docs/file')
async def get_docs_file(name: str = Query(...)):
    if name not in DOCS_ALLOWLIST:
        raise HTTPException(status_code=403, detail='File not in allowlist')
    if DATA_BACKEND != 'ob1':
        path = APP_DIR / name
        if not path.exists():
            raise HTTPException(status_code=404, detail='File not found')
        content = await asyncio.to_thread(path.read_bytes)
        return Response(content, media_type='text/plain; charset=utf-8')
    key = f'docs/{name}'
    try:
        content = await store.get(key)
        return Response(content, media_type='text/plain; charset=utf-8')
    except Exception:
        raise HTTPException(status_code=404, detail='File not found')


# ── Setup status ──────────────────────────────────────────────────────────────

@app.get('/api/setup-status')
async def get_setup_status():
    if DATA_BACKEND != 'ob1' and APPLICANT_DIR:
        path = APPLICANT_DIR / 'memory' / 'applicant-setup-status.md'
        try:
            raw_bytes = await asyncio.to_thread(path.read_bytes)
        except Exception:
            return {'phases': {p: False for p in 'ABCDEF'}, 'raw': ''}
    else:
        key = 'memory/applicant-setup-status.md'
        try:
            raw_bytes = await store.get(key)
        except Exception:
            return {'phases': {p: False for p in 'ABCDEF'}, 'raw': ''}
    try:
        content = raw_bytes.decode('utf-8')
    except Exception:
        return {'phases': {p: False for p in 'ABCDEF'}, 'raw': ''}
    phases: dict[str, bool] = {}
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


# ── Health check ─────────────────────────────────────────────────────────────

@app.get('/api/health')
async def get_health():
    if DATA_BACKEND != 'ob1':
        store_status = 'ok' if (APPLICANT_DIR and APPLICANT_DIR.exists()) else 'error'
        return {'backend': 'local', 'store': store_status}

    db_status = 'error'
    store_status = 'error'
    if _pool is not None:
        try:
            async with _pool.acquire() as conn:
                await conn.fetchval('SELECT 1')
            db_status = 'ok'
        except Exception:
            pass
    try:
        await store.list('memory/applicant-setup-status.md')
        store_status = 'ok'
    except Exception:
        pass
    return {'backend': 'ob1', 'db': db_status, 'store': store_status}


# ── Presigned URL ─────────────────────────────────────────────────────────────

@app.get('/api/file/url')
async def get_file_url(path: str = Query(...)):
    key = _validate_key(path)
    try:
        url = await store.get_presigned_url(key)
        return {'url': url}
    except Exception:
        raise HTTPException(status_code=404, detail='File not found')


# ── Contacts ──────────────────────────────────────────────────────────────────

@app.get('/api/contacts')
async def get_contacts(company: Optional[str] = Query(None)):
    if DATA_BACKEND != 'ob1':
        return []  # no local equivalent for contacts
    pool = _require_pool()
    async with pool.acquire() as conn:
        if company:
            rows = await conn.fetch("""
                SELECT ct.id, ct.name, ct.title, ct.email, ct.linkedin_url,
                       ct.relationship_type, ct.notes, co.name AS company
                FROM js_contacts ct
                LEFT JOIN js_companies co ON ct.company_id = co.id
                WHERE LOWER(co.name) LIKE LOWER($1)
                ORDER BY ct.name
            """, f'%{company}%')
        else:
            rows = await conn.fetch("""
                SELECT ct.id, ct.name, ct.title, ct.email, ct.linkedin_url,
                       ct.relationship_type, ct.notes, co.name AS company
                FROM js_contacts ct
                LEFT JOIN js_companies co ON ct.company_id = co.id
                ORDER BY ct.name
            """)
    return [
        {
            'id': str(r['id']),
            'name': r['name'],
            'title': r['title'] or '',
            'email': r['email'] or '',
            'linkedin_url': r['linkedin_url'] or '',
            'relationship_type': r['relationship_type'] or '',
            'notes': r['notes'] or '',
            'company': r['company'] or '',
        }
        for r in rows
    ]


# ── Delete file ───────────────────────────────────────────────────────────────

@app.delete('/api/file')
async def delete_file(path: str = Query(...)):
    key = _validate_upload_key(path)  # restrict to applications/ and base-documents/
    try:
        await store.delete(key)
    except Exception:
        raise HTTPException(status_code=404, detail='File not found')
    if DATA_BACKEND == 'ob1':
        async with _require_pool().acquire() as conn:
            await conn.execute('DELETE FROM js_files WHERE storage_key = $1', key)
    return {'ok': True}


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
    global _loop, _pool
    _loop = asyncio.get_running_loop()
    if DATA_BACKEND == 'ob1':
        _pool = await asyncpg.create_pool(
            host=os.environ.get('DB_HOST', 'localhost'),
            port=int(os.environ.get('DB_PORT', 5432)),
            database=os.environ.get('DB_NAME', 'openbrain'),
            user=os.environ.get('DB_USER', 'postgres'),
            password=os.environ.get('DB_PASSWORD', ''),
            min_size=2,
            max_size=10,
        )


@app.on_event('shutdown')
async def _on_shutdown() -> None:
    if _pool:
        await _pool.close()


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
