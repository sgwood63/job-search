"""Tests for the ob1 data path — ObRestClient class and all FastAPI endpoints
in DATA_BACKEND=ob1 mode.  No real HTTP calls are made; all ObRestClient
methods are replaced with AsyncMock via the ob1_client / mock_ob_rest fixtures
defined in conftest.py."""

import base64
from unittest.mock import AsyncMock, MagicMock, patch
import pytest


# ===========================================================================
# ObRestClient — unit tests (mock the httpx layer directly)
# ===========================================================================

class FakeResponse:
    """Minimal stand-in for an httpx.Response."""
    def __init__(self, status_code: int, json_data=None, content: bytes = b""):
        self.status_code = status_code
        self._json = json_data
        self.content = content

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}", request=None, response=self
            )

    def json(self):
        return self._json


def make_client(base_url="http://mcp.test", api_key="key123"):
    from main import ObRestClient
    return ObRestClient(base_url, api_key)


@pytest.mark.asyncio
async def test_put_file_text_payload():
    """str content → payload has binary=False and content is the raw string."""
    client = make_client()
    http_mock = MagicMock()
    http_mock.put = AsyncMock(return_value=FakeResponse(201, {"key": "a.md", "bytes": 5}))
    client._client = http_mock

    await client.put_file("a.md", "# Hello", "text/markdown")

    http_mock.put.assert_called_once()
    _, kwargs = http_mock.put.call_args
    payload = kwargs["json"]
    assert payload["content"] == "# Hello"
    assert payload["content_type"] == "text/markdown"
    assert payload["binary"] is False


@pytest.mark.asyncio
async def test_put_file_bytes_base64_encoded():
    """bytes content → payload is base64-encoded with binary=True."""
    client = make_client()
    http_mock = MagicMock()
    http_mock.put = AsyncMock(return_value=FakeResponse(201, {"key": "f.pdf", "bytes": 4}))
    client._client = http_mock

    raw = b"\x89PNG\r\n"
    await client.put_file("f.pdf", raw, "application/pdf")

    _, kwargs = http_mock.put.call_args
    payload = kwargs["json"]
    assert payload["binary"] is True
    assert base64.b64decode(payload["content"]) == raw
    assert payload["content_type"] == "application/pdf"


@pytest.mark.asyncio
async def test_ping_returns_true_on_200():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    assert await client.ping() is True


@pytest.mark.asyncio
async def test_ping_returns_false_on_error():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(side_effect=Exception("connection refused"))
    client._client = http_mock

    assert await client.ping() is False


@pytest.mark.asyncio
async def test_ping_returns_false_on_non_200():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(503, {}))
    client._client = http_mock

    assert await client.ping() is False


@pytest.mark.asyncio
async def test_get_application_returns_none_on_404():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(404, None))
    client._client = http_mock

    result = await client.get_application("missing-id")
    assert result is None


@pytest.mark.asyncio
async def test_get_tracker_passes_filters_as_params():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_tracker(status="applied", limit=50, company=None)

    _, kwargs = http_mock.get.call_args
    params = kwargs["params"]
    assert params["status"] == "applied"
    assert params["limit"] == 50
    assert "company" not in params  # None values must be excluded


@pytest.mark.asyncio
async def test_get_contacts_passes_company_param():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_contacts(company="Acme")

    _, kwargs = http_mock.get.call_args
    assert kwargs["params"] == {"company": "Acme"}


@pytest.mark.asyncio
async def test_get_contacts_no_param_when_company_none():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_contacts(company=None)

    _, kwargs = http_mock.get.call_args
    assert kwargs["params"] == {}


@pytest.mark.asyncio
async def test_search_posts_correct_body():
    client = make_client()
    http_mock = MagicMock()
    http_mock.post = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.search("find jobs", limit=10)

    _, kwargs = http_mock.post.call_args
    assert kwargs["json"] == {"query": "find jobs", "limit": 10}


# ===========================================================================
# Health endpoint — ob1 mode
# ===========================================================================

def test_health_ob1_rest_ok(ob1_client):
    client, mock = ob1_client
    mock.ping = AsyncMock(return_value=True)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["backend"] == "ob1"
    assert data["rest"] == "ok"


def test_health_ob1_rest_error(ob1_client):
    client, mock = ob1_client
    mock.ping = AsyncMock(return_value=False)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["rest"] == "error"


# ===========================================================================
# GET /api/file — ob1 mode
# ===========================================================================

def test_get_file_ob1_returns_content(ob1_client):
    client, mock = ob1_client
    mock.get_file = AsyncMock(return_value=b"# Notes content")
    resp = client.get("/api/file", params={"path": "applications/2026-01-01-co/notes.md"})
    assert resp.status_code == 200
    assert b"Notes content" in resp.content
    mock.get_file.assert_called_once_with("applications/2026-01-01-co/notes.md")


def test_get_file_ob1_not_found(ob1_client):
    client, mock = ob1_client
    mock.get_file = AsyncMock(side_effect=Exception("not found"))
    resp = client.get("/api/file", params={"path": "applications/missing.md"})
    assert resp.status_code == 404


def test_get_file_ob1_path_traversal_blocked(ob1_client):
    client, _ = ob1_client
    resp = client.get("/api/file", params={"path": "../../etc/passwd"})
    assert resp.status_code == 403


# ===========================================================================
# PUT /api/file — ob1 mode
# ===========================================================================

def test_put_file_ob1_calls_put_file(ob1_client):
    client, mock = ob1_client
    resp = client.put(
        "/api/file",
        params={"path": "applications/2026-01-01-co/notes.md"},
        json={"content": "# Updated notes"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    mock.put_file.assert_called_once_with(
        "applications/2026-01-01-co/notes.md", "# Updated notes", "text/markdown"
    )


def test_put_file_ob1_non_markdown_rejected(ob1_client):
    client, mock = ob1_client
    resp = client.put(
        "/api/file",
        params={"path": "applications/folder/resume.pdf"},
        json={"content": "binary"},
    )
    assert resp.status_code == 400
    mock.put_file.assert_not_called()


# ===========================================================================
# DELETE /api/file — ob1 mode
# ===========================================================================

def test_delete_file_ob1_calls_delete(ob1_client):
    client, mock = ob1_client
    resp = client.delete(
        "/api/file",
        params={"path": "applications/2026-01-01-co/notes.md"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    mock.delete_file.assert_called_once_with("applications/2026-01-01-co/notes.md")


def test_delete_file_ob1_error_returns_404(ob1_client):
    client, mock = ob1_client
    mock.delete_file = AsyncMock(side_effect=Exception("not found"))
    resp = client.delete(
        "/api/file",
        params={"path": "applications/2026-01-01-co/notes.md"},
    )
    assert resp.status_code == 404


# ===========================================================================
# POST /api/upload — ob1 mode (binary upload path)
# ===========================================================================

def test_upload_ob1_sends_bytes(ob1_client):
    client, mock = ob1_client
    data = b"%PDF-1.4 fake pdf content"
    resp = client.post(
        "/api/upload",
        params={"dir": "applications/2026-01-01-co"},
        files={"file": ("resume.pdf", data, "application/pdf")},
    )
    assert resp.status_code == 200
    mock.put_file.assert_called_once()
    key, content, mime = mock.put_file.call_args[0]
    assert key == "applications/2026-01-01-co/resume.pdf"
    assert content == data
    assert "pdf" in mime


def test_upload_ob1_blocked_outside_allowed_prefix(ob1_client):
    client, mock = ob1_client
    resp = client.post(
        "/api/upload",
        params={"dir": "profiles/presales-se"},
        files={"file": ("secret.pdf", b"data", "application/pdf")},
    )
    assert resp.status_code == 403
    mock.put_file.assert_not_called()


# ===========================================================================
# GET /api/tracker — ob1 mode
# ===========================================================================

TRACKER_ROW = {
    "id": "42",
    "applied_date": "2026-05-01",
    "company": "Acme Corp",
    "role_title": "Solutions Engineer",
    "profile": "presales-se",
    "status": "applied",
    "status_detail": "",
    "follow_up_date": "2026-05-15",
    "priority": 3,
    "folder_prefix": "applications/2026-05-01-acme-corp-se/",
}


def test_tracker_ob1_returns_rows(ob1_client):
    client, mock = ob1_client
    mock.get_tracker = AsyncMock(return_value=[TRACKER_ROW])
    resp = client.get("/api/tracker")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert len(rows) == 1
    r = rows[0]
    assert r["company"] == "Acme Corp"
    assert r["role"] == "Solutions Engineer"
    assert r["date"] == "2026-05-01"
    assert r["status"] == "applied"
    assert r["follow_up_date"] == "2026-05-15"
    assert r["priority"] == "⭐⭐⭐"


def test_tracker_ob1_priority_star_mapping(ob1_client):
    client, mock = ob1_client
    mock.get_tracker = AsyncMock(return_value=[
        {**TRACKER_ROW, "priority": 1},
        {**TRACKER_ROW, "priority": 2},
        {**TRACKER_ROW, "priority": 3},
    ])
    rows = client.get("/api/tracker").json()["rows"]
    assert rows[0]["priority"] == ""
    assert rows[1]["priority"] == "⭐⭐"
    assert rows[2]["priority"] == "⭐⭐⭐"


def test_tracker_ob1_folder_prefix_stripped(ob1_client):
    client, mock = ob1_client
    mock.get_tracker = AsyncMock(return_value=[TRACKER_ROW])
    row = client.get("/api/tracker").json()["rows"][0]
    assert row["folder"] == "2026-05-01-acme-corp-se"


def test_tracker_ob1_calls_get_tracker(ob1_client):
    client, mock = ob1_client
    client.get("/api/tracker")
    mock.get_tracker.assert_called_once()


# ===========================================================================
# GET /api/applications — ob1 mode
# ===========================================================================

def test_get_applications_ob1_returns_list(ob1_client):
    client, mock = ob1_client
    mock.get_tracker = AsyncMock(return_value=[TRACKER_ROW])
    resp = client.get("/api/applications")
    assert resp.status_code == 200
    names = [a["name"] for a in resp.json()]
    assert "2026-05-01-acme-corp-se" in names


def test_get_applications_ob1_skips_rows_without_folder(ob1_client):
    client, mock = ob1_client
    mock.get_tracker = AsyncMock(return_value=[
        {**TRACKER_ROW, "folder_prefix": None},
        TRACKER_ROW,
    ])
    resp = client.get("/api/applications")
    assert len(resp.json()) == 1


# ===========================================================================
# GET /api/applications/{folder} — ob1 mode
# ===========================================================================

def test_get_application_folder_ob1_found(ob1_client):
    client, mock = ob1_client
    mock.list_files = AsyncMock(return_value=[
        {"key": "applications/2026-05-01-acme/notes.md", "size": 100},
        {"key": "applications/2026-05-01-acme/jd-acme-se.md", "size": 200},
    ])
    resp = client.get("/api/applications/2026-05-01-acme")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "2026-05-01-acme"
    assert "files" in data
    mock.list_files.assert_called_once_with(prefix="applications/2026-05-01-acme/")


def test_get_application_folder_ob1_not_found(ob1_client):
    client, mock = ob1_client
    mock.list_files = AsyncMock(return_value=[])
    resp = client.get("/api/applications/nonexistent-folder")
    assert resp.status_code == 404


# ===========================================================================
# GET /api/contacts — ob1 mode
# ===========================================================================

CONTACT_ROW = {
    "id": "1",
    "name": "Jane Smith",
    "title": "VP Engineering",
    "email": "jane@example.com",
    "linkedin_url": "",
    "relationship_type": "warm",
    "notes": "",
    "company_name": "Acme Corp",
}


def test_get_contacts_ob1_returns_list(ob1_client):
    client, mock = ob1_client
    mock.get_contacts = AsyncMock(return_value=[CONTACT_ROW])
    resp = client.get("/api/contacts")
    assert resp.status_code == 200
    contacts = resp.json()
    assert len(contacts) == 1
    assert contacts[0]["name"] == "Jane Smith"
    assert contacts[0]["company"] == "Acme Corp"


def test_get_contacts_ob1_company_filter_passed(ob1_client):
    client, mock = ob1_client
    mock.get_contacts = AsyncMock(return_value=[])
    client.get("/api/contacts", params={"company": "Acme"})
    mock.get_contacts.assert_called_once_with(company="Acme")


def test_get_contacts_local_mode_returns_empty(client):
    """Contacts endpoint returns empty list in local mode (no local contact store)."""
    resp = client.get("/api/contacts")
    assert resp.status_code == 200
    assert resp.json() == []


# ===========================================================================
# POST /api/semantic-search — ob1 mode
# ===========================================================================

def test_semantic_search_ob1_calls_search(ob1_client):
    client, mock = ob1_client
    mock.search = AsyncMock(return_value=[{"id": "1", "content": "match", "similarity": 0.9}])
    resp = client.post("/api/semantic-search", json={"query": "presales SE", "limit": 3})
    assert resp.status_code == 200
    mock.search.assert_called_once_with(query="presales SE", limit=3)
    assert resp.json()[0]["similarity"] == 0.9


def test_semantic_search_local_mode_returns_501(client):
    resp = client.post("/api/semantic-search", json={"query": "anything"})
    assert resp.status_code == 501


# ===========================================================================
# GET /api/profiles — ob1 mode
# ===========================================================================

def test_get_profiles_ob1_combines_profile_rows_and_files(ob1_client):
    client, mock = ob1_client
    mock.get_profiles = AsyncMock(return_value=[
        {"slug": "presales-se", "display_name": "Pre-Sales SE"},
    ])
    mock.list_files = AsyncMock(return_value=[
        {"key": "profiles/presales-se/presales-se-CONTENT.md", "size": 500},
    ])
    resp = client.get("/api/profiles")
    assert resp.status_code == 200
    data = resp.json()
    profiles = data["profiles"]
    assert len(profiles) == 1
    assert profiles[0]["name"] == "presales-se"
    assert profiles[0]["display_name"] == "Pre-Sales SE"
    assert len(profiles[0]["files"]) == 1


# ===========================================================================
# GET /api/setup-status — ob1 mode
# ===========================================================================

def test_setup_status_ob1_parses_content(ob1_client):
    client, mock = ob1_client
    mock.get_file = AsyncMock(return_value=b"Phase A: complete\nPhase B: complete\n")
    resp = client.get("/api/setup-status")
    assert resp.status_code == 200
    phases = resp.json()["phases"]
    assert phases["A"] is True
    assert phases["B"] is True
    assert phases["C"] is False
    mock.get_file.assert_called_once_with("memory/applicant-setup-status.md")


def test_setup_status_ob1_all_phases_bulk_marker(ob1_client):
    client, mock = ob1_client
    mock.get_file = AsyncMock(return_value=b"Phase A-E: complete\n")
    resp = client.get("/api/setup-status")
    phases = resp.json()["phases"]
    for ph in "ABCDE":
        assert phases[ph] is True


def test_setup_status_ob1_rest_error_returns_false_phases(ob1_client):
    client, mock = ob1_client
    mock.get_file = AsyncMock(side_effect=Exception("REST down"))
    resp = client.get("/api/setup-status")
    assert resp.status_code == 200
    phases = resp.json()["phases"]
    assert all(v is False for v in phases.values())


# ===========================================================================
# GET /api/docs/file — ob1 mode
# ===========================================================================

def test_get_docs_file_ob1_calls_get_file(ob1_client):
    client, mock = ob1_client
    mock.get_file = AsyncMock(return_value=b"# README content")
    resp = client.get("/api/docs/file", params={"name": "README.md"})
    assert resp.status_code == 200
    assert b"README content" in resp.content
    mock.get_file.assert_called_once_with("docs/README.md")


def test_get_docs_file_ob1_not_in_allowlist(ob1_client):
    client, _ = ob1_client
    resp = client.get("/api/docs/file", params={"name": "../../etc/passwd"})
    assert resp.status_code == 403


def test_get_docs_file_ob1_rest_error_returns_404(ob1_client):
    client, mock = ob1_client
    mock.get_file = AsyncMock(side_effect=Exception("not found"))
    resp = client.get("/api/docs/file", params={"name": "README.md"})
    assert resp.status_code == 404


# ===========================================================================
# GET /api/file/url — ob1 mode
# ===========================================================================

def test_get_file_url_ob1_returns_url(ob1_client):
    client, mock = ob1_client
    mock.get_file_url = AsyncMock(return_value="http://minio.test/file.pdf?token=abc")
    resp = client.get("/api/file/url", params={"path": "applications/2026-01-01/resume.pdf"})
    assert resp.status_code == 200
    assert resp.json()["url"] == "http://minio.test/file.pdf?token=abc"
    mock.get_file_url.assert_called_once_with("applications/2026-01-01/resume.pdf")
