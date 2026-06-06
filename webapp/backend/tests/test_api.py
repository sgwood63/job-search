import json
from pathlib import Path
import pytest
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Helpers — tested directly (no HTTP round-trip needed)
# ---------------------------------------------------------------------------

def test_validate_key_dotdot():
    from main import _validate_key
    with pytest.raises(HTTPException) as exc:
        _validate_key("../../etc/passwd")
    assert exc.value.status_code == 403


def test_validate_key_absolute_path():
    from main import _validate_key
    with pytest.raises(HTTPException) as exc:
        _validate_key("/etc/passwd")
    assert exc.value.status_code == 403


def test_validate_key_normal_passes():
    from main import _validate_key
    assert _validate_key("applications/2026-01-01-co/notes.md") == "applications/2026-01-01-co/notes.md"


def test_validate_upload_key_allowed():
    from main import _validate_upload_key
    key = _validate_upload_key("applications/2026-01-01/resume.pdf")
    assert key == "applications/2026-01-01/resume.pdf"


def test_validate_upload_key_blocked():
    from main import _validate_upload_key
    with pytest.raises(HTTPException) as exc:
        _validate_upload_key("profiles/presales-se/secret.md")
    assert exc.value.status_code == 403


def test_rows_to_tree_flat():
    from main import _rows_to_tree
    rows = [
        {"key": "a.md", "size": 10},
        {"key": "b.md", "size": 20},
    ]
    result = _rows_to_tree(rows)
    names = [r["name"] for r in result]
    assert "a.md" in names
    assert "b.md" in names
    assert all(r["type"] == "file" for r in result)


def test_rows_to_tree_nested():
    from main import _rows_to_tree
    rows = [{"key": "dir/sub/file.md", "size": 5}]
    result = _rows_to_tree(rows)
    assert result[0]["type"] == "directory"
    assert result[0]["name"] == "dir"
    sub = result[0]["children"][0]
    assert sub["type"] == "directory"
    assert sub["name"] == "sub"
    leaf = sub["children"][0]
    assert leaf["name"] == "file.md"
    assert leaf["type"] == "file"


# ---------------------------------------------------------------------------
# GET /api/health
# ---------------------------------------------------------------------------

def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["backend"] == "local"
    assert data["store"] == "ok"


def test_health_no_applicant_dir(client, monkeypatch):
    import main as main_mod
    monkeypatch.setattr(main_mod, "APPLICANT_DIR", Path("/nonexistent/path/that/does/not/exist"))
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["store"] == "error"


# ---------------------------------------------------------------------------
# GET /api/tracker
# ---------------------------------------------------------------------------

TRACKER_CONTENT = """\
## Active Applications

| Date | Company | Role | Profile | Source | Status | Status Detail | Next Action | Priority |
|------|---------|------|---------|--------|--------|---------------|-------------|----------|
| 2026-05-01 | Acme Corp | Solutions Engineer | presales-se | LinkedIn | Applied | | Follow up | ⭐️⭐️ |

## Closed / Rejected

| Date | Company | Role | Profile | Status Detail | Notes |
|------|---------|------|---------|---------------|-------|
| 2026-04-01 | OldCo | SDR | sales | Ghosted | |
"""


def test_tracker_empty(client, tmp_applicant):
    resp = client.get("/api/tracker")
    assert resp.status_code == 200
    data = resp.json()
    assert data["active"] == []
    assert data["phase_d"] == []
    assert data["closed"] == []


def test_tracker_with_data(client, tmp_applicant):
    (tmp_applicant / "application-tracker.md").write_text(TRACKER_CONTENT, encoding="utf-8")
    resp = client.get("/api/tracker")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["active"]) == 1
    assert data["active"][0]["company"] == "Acme Corp"
    assert data["active"][0]["role"] == "Solutions Engineer"
    assert len(data["closed"]) == 1
    assert data["closed"][0]["company"] == "OldCo"


# ---------------------------------------------------------------------------
# GET /api/file
# ---------------------------------------------------------------------------

def test_get_file_found(client, tmp_applicant, local_store):
    import asyncio
    asyncio.run(local_store.put("applicant.md", b"# Applicant", "text/markdown"))
    resp = client.get("/api/file", params={"path": "applicant.md"})
    assert resp.status_code == 200
    assert b"Applicant" in resp.content


def test_get_file_missing(client):
    resp = client.get("/api/file", params={"path": "does-not-exist.md"})
    assert resp.status_code == 404


def test_get_file_path_traversal(client):
    resp = client.get("/api/file", params={"path": "../../etc/passwd"})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# PUT /api/file
# ---------------------------------------------------------------------------

def test_put_file_creates_markdown(client, tmp_applicant):
    resp = client.put(
        "/api/file",
        params={"path": "applications/test-folder/notes.md"},
        json={"content": "# Test notes"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    written = (tmp_applicant / "applications" / "test-folder" / "notes.md").read_text()
    assert "Test notes" in written


def test_put_file_non_markdown_rejected(client):
    resp = client.put(
        "/api/file",
        params={"path": "applications/folder/resume.pdf"},
        json={"content": "binary"},
    )
    assert resp.status_code == 400


def test_put_file_path_traversal_rejected(client):
    resp = client.put(
        "/api/file",
        params={"path": "../../evil.md"},
        json={"content": "evil"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /api/file
# ---------------------------------------------------------------------------

def test_delete_file(client, tmp_applicant, local_store):
    import asyncio
    asyncio.run(local_store.put("applications/2026-01-01-co/notes.md", b"to delete", "text/markdown"))
    resp = client.delete("/api/file", params={"path": "applications/2026-01-01-co/notes.md"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert not (tmp_applicant / "applications" / "2026-01-01-co" / "notes.md").exists()


def test_delete_file_missing(client):
    resp = client.delete("/api/file", params={"path": "applications/folder/gone.md"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/applications
# ---------------------------------------------------------------------------

def test_get_applications_empty(client, tmp_applicant):
    resp = client.get("/api/applications")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_applications_returns_folders(client, tmp_applicant):
    (tmp_applicant / "applications" / "2026-05-01-acme-se").mkdir()
    (tmp_applicant / "applications" / "2026-04-15-beta-corp-ae").mkdir()
    resp = client.get("/api/applications")
    assert resp.status_code == 200
    names = [a["name"] for a in resp.json()]
    assert "2026-05-01-acme-se" in names
    assert "2026-04-15-beta-corp-ae" in names


# ---------------------------------------------------------------------------
# GET /api/applications/{folder}
# ---------------------------------------------------------------------------

def test_get_application_found(client, tmp_applicant, local_store):
    import asyncio
    asyncio.run(local_store.put("applications/2026-05-01-acme-se/notes.md", b"# Notes", "text/markdown"))
    resp = client.get("/api/applications/2026-05-01-acme-se")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "2026-05-01-acme-se"
    assert "files" in data


def test_get_application_missing(client):
    resp = client.get("/api/applications/nonexistent-folder")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/setup-status
# ---------------------------------------------------------------------------

def test_setup_status_no_file(client):
    resp = client.get("/api/setup-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["phases"]["A"] is False
    assert data["phases"]["F"] is False


def test_setup_status_phase_a_complete(client, tmp_applicant):
    status_md = "Phase A: complete\nPhase B: in progress\n"
    (tmp_applicant / "memory" / "applicant-setup-status.md").write_text(status_md)
    resp = client.get("/api/setup-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["phases"]["A"] is True
    assert data["phases"]["B"] is False


def test_setup_status_all_complete(client, tmp_applicant):
    status_md = "Phase A–E: complete\n"
    (tmp_applicant / "memory" / "applicant-setup-status.md").write_text(status_md)
    resp = client.get("/api/setup-status")
    data = resp.json()
    for ph in "ABCDE":
        assert data["phases"][ph] is True


# ---------------------------------------------------------------------------
# GET /api/docs/file — allowlist enforcement
# ---------------------------------------------------------------------------

def test_docs_file_not_in_allowlist(client):
    resp = client.get("/api/docs/file", params={"name": "../../etc/passwd"})
    assert resp.status_code == 403


def test_docs_file_allowed_missing(client, monkeypatch, tmp_path):
    import main as main_mod
    # Point APP_DIR at a temp dir that has no README.md
    monkeypatch.setattr(main_mod, "APP_DIR", tmp_path)
    resp = client.get("/api/docs/file", params={"name": "README.md"})
    assert resp.status_code == 404


def test_docs_file_allowed_found(client, monkeypatch, tmp_path):
    import main as main_mod
    (tmp_path / "README.md").write_text("# Job Search")
    monkeypatch.setattr(main_mod, "APP_DIR", tmp_path)
    resp = client.get("/api/docs/file", params={"name": "README.md"})
    assert resp.status_code == 200
    assert b"Job Search" in resp.content
