import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from tracker import parse_tracker

env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

_raw = os.environ.get('APPLICANT_DIR', '')
APPLICANT_DIR = Path(_raw.strip('"').strip("'"))
if not APPLICANT_DIR.exists():
    raise RuntimeError(f'APPLICANT_DIR does not exist: {APPLICANT_DIR}')

UPLOAD_ROOTS = [
    APPLICANT_DIR / 'base-documents',
    APPLICANT_DIR / 'applications',
]

app = FastAPI()

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
        return []
    profiles = []
    for entry in sorted(profiles_dir.iterdir(), key=lambda e: e.name):
        if entry.is_dir() and not entry.name.startswith('.') and entry.name != 'search-results':
            profiles.append({
                'name': entry.name,
                'path': f'profiles/{entry.name}',
                'files': build_tree(entry, APPLICANT_DIR),
            })
    return profiles


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


# Serve built frontend in production
frontend_dist = Path(__file__).parent.parent / 'frontend' / 'dist'
if frontend_dist.exists():
    app.mount('/', StaticFiles(directory=frontend_dist, html=True), name='static')
