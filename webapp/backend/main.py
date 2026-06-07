import asyncio
import base64
import glob
import json
import mimetypes
import os
import re
import select
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

_app_raw = os.environ.get('APP_DIR', '')
APP_DIR = Path(_app_raw.strip('"').strip("'")) if _app_raw else Path(__file__).parent.parent.parent

_applicant_raw = os.environ.get('APPLICANT_DIR', '')
APPLICANT_DIR = Path(_applicant_raw.strip('"').strip("'")) if _applicant_raw else None

DATA_BACKEND = os.environ.get('DATA_BACKEND', 'local').lower()

CLAUDE_BINARY = os.environ.get('CLAUDE_BINARY', 'claude')
CLAUDE_RUNNER_URL = os.environ.get('CLAUDE_RUNNER_URL', '').rstrip('/')

DOCS_ALLOWLIST = {
    'README.md', 'USER-GUIDE.md', 'QUICK-START.md',
    'applicant-setup.md', 'DEVELOPER-README.md',
}

ALLOWED_UPLOAD_PREFIXES = ('applications/', 'base-documents/')

app = FastAPI()

# ---------------------------------------------------------------------------
# OB1 REST client — replaces direct MinIO + Postgres access in ob1 mode
# ---------------------------------------------------------------------------

class ObRestClient:
    """Thin wrapper around the job-search MCP server REST API (/api/v2/*)."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base = base_url.rstrip('/')
        self._key = api_key
        self._client: httpx.AsyncClient | None = None

    @property
    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base,
                headers={'x-brain-key': self._key},
                timeout=60.0,
            )
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()

    async def get_file(self, key: str) -> bytes:
        r = await self._http.get(f'/api/v2/files/{key}')
        r.raise_for_status()
        return r.content

    async def get_file_url(self, key: str, expires_in: int = 3600) -> str:
        r = await self._http.get(f'/api/v2/file-url/{key}', params={'expires_in': expires_in})
        r.raise_for_status()
        return r.json()['url']

    async def list_files(self, prefix: str = '') -> list[dict]:
        r = await self._http.get('/api/v2/files', params={'prefix': prefix})
        r.raise_for_status()
        return r.json()

    async def put_file(self, key: str, content: bytes | str, content_type: str = 'text/markdown') -> dict:
        if isinstance(content, bytes):
            payload = {
                'content': base64.b64encode(content).decode('ascii'),
                'content_type': content_type,
                'binary': True,
            }
        else:
            payload = {'content': content, 'content_type': content_type, 'binary': False}
        r = await self._http.put(f'/api/v2/files/{key}', json=payload)
        r.raise_for_status()
        return r.json()

    async def delete_file(self, key: str) -> dict:
        r = await self._http.delete(f'/api/v2/files/{key}')
        r.raise_for_status()
        return r.json()

    async def get_tracker(self, **filters) -> list[dict]:
        params = {k: v for k, v in filters.items() if v is not None}
        r = await self._http.get('/api/v2/tracker', params=params)
        r.raise_for_status()
        return r.json()

    async def get_profiles(self) -> list[dict]:
        r = await self._http.get('/api/v2/profiles')
        r.raise_for_status()
        return r.json()

    async def get_application(self, identifier: str) -> dict | None:
        r = await self._http.get(f'/api/v2/applications/{identifier}')
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    async def get_contacts(self, company: str | None = None) -> list[dict]:
        params = {'company': company} if company else {}
        r = await self._http.get('/api/v2/contacts', params=params)
        r.raise_for_status()
        return r.json()

    async def search(self, query: str, limit: int = 5) -> list[dict]:
        r = await self._http.post('/api/v2/search', json={'query': query, 'limit': limit})
        r.raise_for_status()
        return r.json()

    async def ping(self) -> bool:
        try:
            r = await self._http.get('/api/v2/profiles', timeout=5.0)
            return r.status_code == 200
        except Exception:
            return False


_ob_rest: ObRestClient | None = None

# Local-mode store (used only when DATA_BACKEND != 'ob1')
_local_store = None

def _get_local_store():
    global _local_store
    if _local_store is None:
        from storage import make_store
        _local_store = make_store()
    return _local_store


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        elif request.url.path in ('/', '/index.html'):
            response.headers['Cache-Control'] = 'no-cache'
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


_STATUS_NORMALIZE = {
    'Pending Review': 'pending-review',
    'Resume Ready': 'resume-ready',
    'Applied': 'applied',
    'Interview Scheduled': 'interview-scheduled',
    'Interview scheduled': 'interview-scheduled',
    'Interviewed': 'interviewed',
    'Exercise/Test requested': 'exercise',
    'Exercise/Test': 'exercise',
    'Offer': 'offer',
    'Closed': 'closed',
    'Not Interested': 'not-interested',
}


def _local_tracker() -> dict:
    from tracker import parse_tracker
    if not APPLICANT_DIR:
        return {'rows': []}
    tracker_path = APPLICANT_DIR / 'application-tracker.md'
    if not tracker_path.exists():
        return {'rows': []}
    content = tracker_path.read_text(encoding='utf-8')
    parsed = parse_tracker(content, APPLICANT_DIR)

    rows: list[dict] = []

    for r in parsed.get('active', []):
        raw_status = r.get('status', '')
        rows.append({
            'id': '',
            'date': r.get('date', ''),
            'company': r.get('company', ''),
            'role': r.get('role', ''),
            'profile': r.get('profile', ''),
            'status': _STATUS_NORMALIZE.get(raw_status, raw_status.lower().replace(' ', '-')),
            'status_detail': r.get('status_detail', ''),
            'follow_up_date': r.get('next_action', ''),
            'priority': r.get('priority', ''),
            'folder': r.get('folder') or '',
        })

    for r in parsed.get('phase_d', []):
        rows.append({
            'id': '',
            'date': r.get('date', ''),
            'company': r.get('company', ''),
            'role': r.get('role', ''),
            'profile': r.get('profile', ''),
            'status': 'interview-scheduled',
            'status_detail': r.get('notes', ''),
            'follow_up_date': '',
            'priority': '',
            'folder': r.get('folder') or '',
        })

    for r in parsed.get('closed', []):
        rows.append({
            'id': '',
            'date': r.get('date', ''),
            'company': r.get('company', ''),
            'role': r.get('role', ''),
            'profile': r.get('profile', ''),
            'status': 'closed',
            'status_detail': r.get('status_detail', '') or r.get('notes', ''),
            'follow_up_date': '',
            'priority': '',
            'folder': r.get('folder') or '',
        })

    return {'rows': rows}


# ---------------------------------------------------------------------------
# Tracker
# ---------------------------------------------------------------------------

@app.get('/api/tracker')
async def get_tracker():
    if DATA_BACKEND != 'ob1':
        return await asyncio.get_event_loop().run_in_executor(None, _local_tracker)

    raw_rows = await _ob_rest.get_tracker(limit=200)
    result_rows = []
    for r in raw_rows:
        display_date = r.get('applied_date') or (r.get('created_at') or '')[:10]
        fup = r.get('follow_up_date') or ''
        pri = r.get('priority') or 1
        result_rows.append({
            'id': str(r.get('id', '')),
            'date': display_date,
            'company': r.get('company') or '',
            'role': r.get('role_title') or '',
            'profile': r.get('profile') or '',
            'status': r.get('status') or '',
            'status_detail': r.get('status_detail') or '',
            'follow_up_date': fup[:10] if fup else '',
            'priority': {3: '⭐⭐⭐', 2: '⭐⭐', 1: ''}.get(pri, ''),
            'folder': (r.get('folder_prefix') or '').removeprefix('applications/').rstrip('/'),
        })
    return {'rows': result_rows}


# ---------------------------------------------------------------------------
# File listing endpoints
# ---------------------------------------------------------------------------

@app.get('/api/root-files')
async def get_root_files():
    if DATA_BACKEND != 'ob1':
        rows = await asyncio.to_thread(lambda: _local_scan(''))
        return [r for r in rows if '/' not in r['key']]

    all_files = await _ob_rest.list_files(prefix='')
    return [
        {'name': f['key'], 'path': f['key'], 'size': f['size']}
        for f in all_files if '/' not in f['key']
    ]


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

    profile_rows, file_rows = await asyncio.gather(
        _ob_rest.get_profiles(),
        _ob_rest.list_files(prefix='profiles/'),
    )

    profiles = []
    for p in profile_rows:
        prefix = f"profiles/{p['slug']}/"
        files = [f for f in file_rows if f['key'].startswith(prefix)]
        profiles.append({
            'name': p['slug'],
            'display_name': p.get('display_name') or p['slug'].replace('-', ' ').title(),
            'path': f"profiles/{p['slug']}",
            'files': _rows_to_tree(files),
        })
    reference_files = [
        {'name': f['key'].split('/')[-1], 'path': f['key'], 'type': 'file', 'size': f['size']}
        for f in file_rows if f['key'].count('/') == 1
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

    rows = await _ob_rest.get_tracker(limit=200)
    return [
        {
            'name': (r.get('folder_prefix') or '').removeprefix('applications/').rstrip('/'),
            'path': (r.get('folder_prefix') or '').rstrip('/'),
        }
        for r in rows if r.get('folder_prefix')
    ]


@app.get('/api/applications/{folder}')
async def get_application(folder: str):
    prefix = f'applications/{folder}/'
    if DATA_BACKEND != 'ob1':
        rows = await asyncio.to_thread(lambda: _local_scan(f'applications/{folder}'))
        if not rows:
            raise HTTPException(status_code=404, detail='Application folder not found')
        return {'name': folder, 'path': f'applications/{folder}', 'files': _rows_to_tree(rows)}

    files = await _ob_rest.list_files(prefix=prefix)
    if not files:
        raise HTTPException(status_code=404, detail='Application folder not found')
    return {
        'name': folder,
        'path': f'applications/{folder}',
        'files': _rows_to_tree(files),
    }


@app.get('/api/base-documents')
async def get_base_documents():
    if DATA_BACKEND != 'ob1':
        rows = await asyncio.to_thread(lambda: _local_scan('base-documents'))
        return _rows_to_tree(rows)

    files = await _ob_rest.list_files(prefix='base-documents/')
    return _rows_to_tree(files)


@app.get('/api/search-results')
async def get_search_results():
    if DATA_BACKEND != 'ob1':
        rows = await asyncio.to_thread(lambda: _local_scan('search'))
        return _rows_to_tree(rows)

    files = await _ob_rest.list_files(prefix='search/')
    return _rows_to_tree(files)


# ---------------------------------------------------------------------------
# File read / write / upload / download
# ---------------------------------------------------------------------------

@app.get('/api/file')
async def get_file(path: str = Query(...)):
    key = _validate_key(path)
    try:
        if DATA_BACKEND == 'ob1':
            content = await _ob_rest.get_file(key)
        else:
            content = await _get_local_store().get(key)
        mime = mimetypes.guess_type(key)[0] or 'application/octet-stream'
        return Response(content, media_type=mime)
    except Exception:
        raise HTTPException(status_code=404, detail='File not found')


@app.get('/api/download')
async def download_file(path: str = Query(...)):
    key = _validate_key(path)
    try:
        if DATA_BACKEND == 'ob1':
            content = await _ob_rest.get_file(key)
        else:
            content = await _get_local_store().get(key)
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
    if DATA_BACKEND == 'ob1':
        await _ob_rest.put_file(key, body.content, 'text/markdown')
    else:
        await _get_local_store().put(key, body.content.encode('utf-8'), 'text/markdown')
    return {'ok': True}


@app.post('/api/upload')
async def upload_file(dir: str = Query(...), file: UploadFile = File(...)):
    key = _validate_upload_key(f"{dir.rstrip('/')}/{file.filename}")
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='File too large (max 50 MB)')
    mime = mimetypes.guess_type(file.filename)[0] or 'application/octet-stream'
    if DATA_BACKEND == 'ob1':
        await _ob_rest.put_file(key, data, mime)
    else:
        await _get_local_store().put(key, data, mime)
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

    files = await _ob_rest.list_files(prefix='docs/')
    return [
        {'name': f['key'].replace('docs/', ''), 'size': f['size']}
        for f in files
        if f['key'].replace('docs/', '') in DOCS_ALLOWLIST
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
    try:
        content = await _ob_rest.get_file(f'docs/{name}')
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
        try:
            raw_bytes = await _ob_rest.get_file('memory/applicant-setup-status.md')
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

    rest_ok = await _ob_rest.ping()
    return {'backend': 'ob1', 'rest': 'ok' if rest_ok else 'error'}


# ── Presigned URL ─────────────────────────────────────────────────────────────

@app.get('/api/file/url')
async def get_file_url(path: str = Query(...)):
    key = _validate_key(path)
    try:
        if DATA_BACKEND == 'ob1':
            url = await _ob_rest.get_file_url(key)
        else:
            url = await _get_local_store().get_presigned_url(key)
        return {'url': url}
    except Exception:
        raise HTTPException(status_code=404, detail='File not found')


# ── Contacts ──────────────────────────────────────────────────────────────────

@app.get('/api/contacts')
async def get_contacts(company: Optional[str] = Query(None)):
    if DATA_BACKEND != 'ob1':
        return []

    rows = await _ob_rest.get_contacts(company=company)
    return [
        {
            'id': str(r.get('id', '')),
            'name': r.get('name') or '',
            'title': r.get('title') or '',
            'email': r.get('email') or '',
            'linkedin_url': r.get('linkedin_url') or '',
            'relationship_type': r.get('relationship_type') or '',
            'notes': r.get('notes') or '',
            'company': r.get('company_name') or '',
        }
        for r in rows
    ]


# ── Semantic search ───────────────────────────────────────────────────────────

@app.post('/api/semantic-search')
async def semantic_search(body: dict):
    if DATA_BACKEND != 'ob1':
        raise HTTPException(status_code=501, detail='Semantic search requires OB1 backend')
    results = await _ob_rest.search(
        query=body.get('query', ''),
        limit=body.get('limit', 5),
    )
    return results


# ── Delete file ───────────────────────────────────────────────────────────────

@app.delete('/api/file')
async def delete_file(path: str = Query(...)):
    key = _validate_upload_key(path)
    try:
        if DATA_BACKEND == 'ob1':
            await _ob_rest.delete_file(key)
        else:
            await _get_local_store().delete(key)
    except Exception:
        raise HTTPException(status_code=404, detail='File not found')
    return {'ok': True}


# ── Session management (subprocess --print mode) ──────────────────────────────

@dataclass
class ChatSession:
    id: str
    label: str
    created_at: float
    status: str              # 'executing' | 'waiting' | 'closed'
    mode: str                # 'execute' | 'plan'
    claude_session_id: Optional[str] = None
    messages_structured: list = field(default_factory=list)
    clients: list = field(default_factory=list)
    current_proc: Any = None


_sessions: dict[str, ChatSession] = {}
_sessions_lock = threading.Lock()
_loop: Optional[asyncio.AbstractEventLoop] = None


@app.on_event('startup')
async def _on_startup() -> None:
    global _loop, _ob_rest
    _loop = asyncio.get_running_loop()
    if DATA_BACKEND == 'ob1':
        _ob_rest = ObRestClient(
            base_url=os.environ.get('JOB_SEARCH_REST_URL', 'http://job-search-mcp.openbrain.svc.cluster.local:8001'),
            api_key=os.environ.get('JOB_SEARCH_MCP_KEY', ''),
        )


@app.on_event('shutdown')
async def _on_shutdown() -> None:
    if _ob_rest:
        await _ob_rest.close()


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


def _stream_via_runner(cmd: list, message: str):
    """Call the claude-runner sidecar and yield NDJSON lines from its streaming response."""
    import http.client
    import urllib.parse
    parsed = urllib.parse.urlparse(CLAUDE_RUNNER_URL)
    body = json.dumps({'args': cmd, 'cwd': str(APP_DIR), 'message': message}).encode()
    conn = http.client.HTTPConnection(parsed.netloc, timeout=300)
    try:
        conn.request('POST', (parsed.path or '') + '/run', body,
                     {'Content-Type': 'application/json'})
        resp = conn.getresponse()
        for raw in resp:
            yield raw.decode('utf-8')
    finally:
        conn.close()


def _resolve_claude_binary() -> str:
    """Return the best available Claude binary path.

    When CLAUDE_RUNNER_URL is set (container/runner mode), the cmd is forwarded
    to the runner sidecar which executes it inside its own container — never
    send a local VS Code extension path there.

    Local mode priority:
      1. CLAUDE_BINARY env var if set and the file exists (explicit pin / fallback)
      2. Latest VS Code extension binary, auto-discovered by semver
      3. System PATH 'claude'
    """
    load_dotenv(env_path, override=True)
    explicit = os.environ.get('CLAUDE_BINARY', '')

    if CLAUDE_RUNNER_URL:
        return explicit or 'claude'

    if explicit and os.path.isfile(explicit):
        return explicit

    candidates = glob.glob(os.path.expanduser(
        '~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude'
    ))
    if candidates:
        def _ver(path: str):
            m = re.search(r'claude-code-(\d+)\.(\d+)\.(\d+)', path)
            return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else (0, 0, 0)
        candidates.sort(key=_ver, reverse=True)
        return candidates[0]

    return shutil.which('claude') or 'claude'


def _run_message_thread(session: ChatSession, message: str) -> None:
    """Spawn `claude -p --output-format stream-json` for one user message, stream chunks.

    When CLAUDE_RUNNER_URL is set, delegates subprocess management to the
    claude-runner sidecar (http://localhost:8090) instead of spawning locally.
    """
    binary = _resolve_claude_binary()
    if not shutil.which(binary) and not os.path.isfile(binary):
        session.status = 'waiting'
        _broadcast(session, {
            'type': 'session_error',
            'content': 'Claude binary not found. Install Claude Code or set CLAUDE_BINARY in .env.',
        })
        return
    cmd = [
        binary, '-p',
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
    ]
    if session.mode == 'plan':
        cmd += ['--permission-mode', 'plan']
    if session.claude_session_id:
        cmd += ['--resume', session.claude_session_id]
    if DATA_BACKEND == 'ob1':
        cmd += [
            '--append-system-prompt',
            (
                'CRITICAL: You are running inside the job search webapp. '
                'DATA_BACKEND is ob1. All applicant data reads and writes MUST '
                'use MCP tools (get_file, upload_file, get_pipeline, update_application_status, etc.). '
                'Never access PostgreSQL directly. Never write files to APPLICANT_DIR. '
                'If MCP tools are unavailable, stop and report the error — do not fall back to local files or direct DB access.'
            ),
        ]

    session.status = 'executing'
    _broadcast(session, {'type': 'status', 'status': 'executing'})

    proc = None
    try:
        if CLAUDE_RUNNER_URL:
            lines = _stream_via_runner(cmd, message)
        else:
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
            lines = proc.stdout

        prev_text = ''
        last_saved_text = None

        def _iter_lines():
            """Yield lines from stdout; exits promptly when proc is done.

            Grandchildren spawned by Claude Code (e.g. Stop hook subprocesses) can
            inherit the write end of the pipe and keep it open after Claude exits.
            Using select with a short timeout lets us break out once proc.poll()
            returns non-None and no new data arrives, instead of hanging forever.
            """
            if proc is None:
                yield from lines
                return
            DRAIN_TIMEOUT = 3.0
            POLL_INTERVAL = 1.0
            while True:
                exited = proc.poll() is not None
                timeout = DRAIN_TIMEOUT if exited else POLL_INTERVAL
                try:
                    ready, _, _ = select.select([proc.stdout], [], [], timeout)
                except Exception:
                    break
                if ready:
                    line = proc.stdout.readline()
                    if line:
                        yield line
                    else:
                        break
                elif exited:
                    break

        for raw_line in _iter_lines():
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                obj = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            if 'session_id' in obj and not session.claude_session_id:
                session.claude_session_id = obj['session_id']

            if obj.get('type') == 'user':
                for block in obj.get('message', {}).get('content', []):
                    if block.get('type') == 'tool_result' and block.get('is_error'):
                        err_text = str(block.get('content', ''))
                        if any(tok in err_text for tok in ('MCP', 'connect', 'ECONNREFUSED', 'ENOTFOUND')):
                            session.status = 'closed'
                            _broadcast(session, {
                                'type': 'session_error',
                                'content': (
                                    'MCP server connection was lost mid-session. '
                                    'This session has been closed — start a new session to continue.'
                                ),
                            })
                            if proc is not None:
                                proc.terminate()
                            session.current_proc = None
                            return
            elif obj.get('type') == 'assistant':
                content_blocks = obj.get('message', {}).get('content', [])
                current_text = ''.join(
                    b.get('text', '') for b in content_blocks if b.get('type') == 'text'
                )
                if not current_text:
                    continue
                if current_text.startswith(prev_text):
                    delta = current_text[len(prev_text):]
                    if delta:
                        _broadcast(session, {'type': 'assistant_chunk', 'content': delta})
                    prev_text = current_text
                else:
                    if prev_text and prev_text != last_saved_text:
                        seg = {'role': 'assistant', 'content': prev_text, 'ts': time.time()}
                        session.messages_structured.append(seg)
                        _broadcast(session, {'type': 'assistant_message', 'content': prev_text, 'ts': seg['ts']})
                        last_saved_text = prev_text
                    prev_text = current_text
                    _broadcast(session, {'type': 'assistant_chunk', 'content': current_text})

        if proc is not None:
            proc.wait()
    except Exception:
        pass

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

    if session.messages_structured:
        await websocket.send_text(json.dumps({'type': 'replay', 'messages': session.messages_structured}))
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
                if text:
                    if session.status == 'executing':
                        await websocket.send_text(json.dumps({
                            'type': 'error',
                            'content': 'Still processing the previous message — please wait.',
                        }))
                    else:
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

frontend_dist = Path(__file__).parent.parent / 'frontend' / 'dist'
if frontend_dist.exists():
    @app.get('/{full_path:path}', include_in_schema=False)
    async def serve_spa(full_path: str):
        file_path = frontend_dist / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_dist / 'index.html')
