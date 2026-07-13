import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
import pytest

# Ensure backend/ is on the path so tests can import main, storage, tracker
sys.path.insert(0, str(Path(__file__).parent.parent))

# Set env vars before any import of main or storage so module-level code
# (load_dotenv, make_store) doesn't try to read a real .env.
os.environ.setdefault("DATA_BACKEND", "local")
os.environ.setdefault("APPLICANT_DIR", "/tmp/test-applicant")
os.environ.setdefault("APP_DIR", str(Path(__file__).parent.parent.parent.parent))

from runtime import build_version_map, load_registry, load_version_map, merge_version_map


@pytest.fixture(scope='session')
def real_registry():
    """The live repo registry — session-scoped since it's read-only and
    reloading per-test buys nothing (resolve() always re-reads version files
    fresh regardless)."""
    return load_registry(Path(os.environ['APP_DIR']))


@pytest.fixture(scope='session')
def version_map(real_registry) -> dict:
    """name -> version to use in tests. Defaults to live pinned state; if
    SKILL_VERSION_MAP points at a JSON file, its entries override the default
    for a specific, opt-in coherent combination (frozen baseline or candidate
    version test) — everything not mentioned stays at current pinned."""
    default = build_version_map(real_registry, mode='pinned')
    override_path = os.environ.get('SKILL_VERSION_MAP')
    if override_path:
        default = merge_version_map(default, load_version_map(override_path))
    return default


@pytest.fixture
def tmp_applicant(tmp_path: Path) -> Path:
    """Minimal APPLICANT_DIR structure in a temp directory."""
    (tmp_path / "applications").mkdir()
    (tmp_path / "memory").mkdir()
    (tmp_path / "profiles").mkdir()
    return tmp_path


@pytest.fixture
def local_store(tmp_applicant: Path, monkeypatch):
    """LocalStore pointed at tmp_applicant; resets the singleton each call."""
    import storage as storage_mod
    monkeypatch.setenv("APPLICANT_DIR", str(tmp_applicant))
    monkeypatch.setenv("DATA_BACKEND", "local")
    storage_mod._store = None  # Reset singleton
    store = storage_mod.make_store()
    yield store
    storage_mod._store = None  # Clean up after test


@pytest.fixture
def client(tmp_applicant: Path, local_store, monkeypatch):
    """FastAPI TestClient in local mode with APPLICANT_DIR and store patched."""
    from starlette.testclient import TestClient
    import main as main_mod

    monkeypatch.setattr(main_mod, "APPLICANT_DIR", tmp_applicant)
    monkeypatch.setattr(main_mod, "DATA_BACKEND", "local")
    monkeypatch.setattr(main_mod, "_local_store", local_store)

    with TestClient(main_mod.app) as c:
        yield c


@pytest.fixture
def mock_ob_rest():
    """AsyncMock stand-in for ObRestClient — pre-wired with sensible defaults."""
    m = MagicMock()
    m.get_file = AsyncMock(return_value=b"# Content")
    m.get_file_url = AsyncMock(return_value="http://minio.test/file.md?token=x")
    m.list_files = AsyncMock(return_value=[])
    m.put_file = AsyncMock(return_value={"key": "test.md", "bytes": 10})
    m.delete_file = AsyncMock(return_value={"deleted": True})
    m.get_tracker = AsyncMock(return_value=[])
    m.get_profiles = AsyncMock(return_value=[])
    m.get_application = AsyncMock(return_value=None)
    m.get_contacts = AsyncMock(return_value=[])
    m.search = AsyncMock(return_value=[])
    m.update_application_fields = AsyncMock(return_value={"id": "1", "domain_connection": "AI productivity"})
    m.search_chunks = AsyncMock(return_value=[])
    m.find_similar_applications = AsyncMock(return_value=[])
    m.get_ingestion_history = AsyncMock(return_value=[])
    m.get_search_runs = AsyncMock(return_value=[])
    m.get_thoughts = AsyncMock(return_value={"thoughts": [], "total": 0})
    m.get_thought = AsyncMock(return_value={"id": "1", "content": "# Test", "metadata": {}, "created_at": "2026-01-01T00:00:00"})
    m.search_thoughts = AsyncMock(return_value={"results": [], "total": 0})
    m.get_thought_stats = AsyncMock(return_value={"total": 0, "by_type": {}})
    m.get_thought_connections = AsyncMock(return_value=[])
    m.ping = AsyncMock(return_value=True)
    m.close = AsyncMock(return_value=None)
    return m


@pytest.fixture
def ob1_client(mock_ob_rest, monkeypatch):
    """FastAPI TestClient in ob1 mode with _ob_rest replaced by mock_ob_rest.

    Patches are applied INSIDE the TestClient context so they override whatever
    the startup event created (startup runs when the 'with' block opens and may
    create a real ObRestClient if DATA_BACKEND=ob1 is in the environment).
    """
    from starlette.testclient import TestClient
    import main as main_mod

    with TestClient(main_mod.app) as c:
        monkeypatch.setattr(main_mod, "DATA_BACKEND", "ob1")
        monkeypatch.setattr(main_mod, "_ob_rest", mock_ob_rest)
        yield c, mock_ob_rest
