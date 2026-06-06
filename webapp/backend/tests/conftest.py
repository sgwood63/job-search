import os
import sys
from pathlib import Path
import pytest

# Ensure backend/ is on the path so tests can import main, storage, tracker
sys.path.insert(0, str(Path(__file__).parent.parent))

# Set env vars before any import of main or storage so module-level code
# (load_dotenv, make_store) doesn't try to read a real .env.
os.environ.setdefault("DATA_BACKEND", "local")
os.environ.setdefault("APPLICANT_DIR", "/tmp/test-applicant")
os.environ.setdefault("APP_DIR", str(Path(__file__).parent.parent.parent.parent))


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
    """FastAPI TestClient with APPLICANT_DIR, DATA_BACKEND, and store all patched."""
    from starlette.testclient import TestClient
    import main as main_mod

    monkeypatch.setattr(main_mod, "APPLICANT_DIR", tmp_applicant)
    monkeypatch.setattr(main_mod, "DATA_BACKEND", "local")
    monkeypatch.setattr(main_mod, "store", local_store)

    with TestClient(main_mod.app) as c:
        yield c
