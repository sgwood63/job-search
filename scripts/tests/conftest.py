"""
Shared fixtures and bootstrap for scripts/tests/.

Sets APP_DIR before any test module is imported — both fetch scripts call
_resolve_auth_dir() at module level and exit(1) if neither AUTH_DIR nor APP_DIR
is set.  Setting APP_DIR here satisfies that check without needing a real .auth/
directory to exist.
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

import pytest

# ── Bootstrap ────────────────────────────────────────────────────────────────
# Must run before any test module is collected.
_TEMP_APP = Path(tempfile.mkdtemp(prefix="test-app-"))
(_TEMP_APP / ".auth").mkdir()
os.environ.setdefault("APP_DIR", str(_TEMP_APP))

SCRIPTS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))


# ── Script loader ─────────────────────────────────────────────────────────────
def _load_script(name: str):
    """Load a script whose filename contains hyphens as a Python module."""
    path = SCRIPTS_DIR / name
    module_name = name.replace("-", "_").replace(".py", "")
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── Session-scoped script fixtures ───────────────────────────────────────────
@pytest.fixture(scope="session")
def fetch_linkedin():
    return _load_script("fetch-linkedin-recs.py")


@pytest.fixture(scope="session")
def fetch_jd():
    return _load_script("fetch-jd.py")


# ── Per-test auth dir fixture (for subprocess exit-code tests) ────────────────
@pytest.fixture
def tmp_auth_dir(tmp_path):
    """
    Override APP_DIR to a fresh temp directory with an empty .auth/ subdirectory.
    Used by subprocess exit-code tests to simulate missing auth files.
    """
    (tmp_path / ".auth").mkdir()
    old = os.environ.get("APP_DIR")
    os.environ["APP_DIR"] = str(tmp_path)
    yield tmp_path
    if old is None:
        del os.environ["APP_DIR"]
    else:
        os.environ["APP_DIR"] = old


# ── Playwright Python helper ──────────────────────────────────────────────────
def playwright_python() -> str:
    """Return the Python interpreter that has Playwright installed."""
    return os.environ.get("PLAYWRIGHT_PYTHON", sys.executable)
