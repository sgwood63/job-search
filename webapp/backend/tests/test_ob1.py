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
async def test_put_file_ob1_sends_thought_category_as_query_param():
    """thought_category is appended as a query param, not a body field."""
    client = make_client()
    http_mock = MagicMock()
    http_mock.put = AsyncMock(return_value=FakeResponse(201, {"key": "a.md", "bytes": 5}))
    client._client = http_mock

    await client.put_file("a.md", "# Hello", "text/markdown", thought_category="email")

    url_called = http_mock.put.call_args[0][0]
    assert "thought_category=email" in url_called


@pytest.mark.asyncio
async def test_put_file_ob1_omits_thought_category_when_none():
    """No thought_category arg → URL has no query string."""
    client = make_client()
    http_mock = MagicMock()
    http_mock.put = AsyncMock(return_value=FakeResponse(201, {"key": "a.md", "bytes": 5}))
    client._client = http_mock

    await client.put_file("a.md", "# Hello", "text/markdown")

    url_called = http_mock.put.call_args[0][0]
    assert "?" not in url_called


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


def test_upload_ob1_forwards_thought_category_kwarg(ob1_client):
    """thought_category query param is passed through to put_file as a keyword arg."""
    client, mock = ob1_client
    resp = client.post(
        "/api/upload",
        params={"dir": "applications/2026-01-01-co", "thought_category": "email"},
        files={"file": ("email.txt", b"From: hiring@acme.com", "text/plain")},
    )
    assert resp.status_code == 200
    kwargs = mock.put_file.call_args.kwargs
    assert kwargs.get("thought_category") == "email"


def test_upload_ob1_response_includes_thought_id_and_category(ob1_client):
    """When OB1 returns thought_id and thought_category they appear in the response body."""
    client, mock = ob1_client
    mock.put_file = AsyncMock(return_value={
        "key": "applications/2026-01-01-co/email.txt",
        "bytes": 22,
        "thought_id": "abc123",
        "thought_category": "email",
    })
    resp = client.post(
        "/api/upload",
        params={"dir": "applications/2026-01-01-co"},
        files={"file": ("email.txt", b"From: hiring@acme.com", "text/plain")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["thought_id"] == "abc123"
    assert data["thought_category"] == "email"


def test_upload_ob1_response_omits_thought_fields_when_absent(ob1_client):
    """When OB1 does not return thought fields they are absent from the response."""
    client, mock = ob1_client
    # Default mock returns {"key": "test.md", "bytes": 10} — no thought fields
    resp = client.post(
        "/api/upload",
        params={"dir": "applications/2026-01-01-co"},
        files={"file": ("resume.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "thought_id" not in data
    assert "thought_category" not in data


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


# ===========================================================================
# ObRestClient — new Phase 2+3 methods
# ===========================================================================

@pytest.mark.asyncio
async def test_update_application_fields_sends_patch():
    client = make_client()
    http_mock = MagicMock()
    http_mock.patch = AsyncMock(return_value=FakeResponse(200, {"id": "1", "domain_connection": "AI tools"}))
    client._client = http_mock

    result = await client.update_application_fields("app-uuid-1", domain_connection="AI tools", domain_tags=["ai", "saas"])

    http_mock.patch.assert_called_once()
    args, kwargs = http_mock.patch.call_args
    assert "/api/v2/applications/app-uuid-1/fields" in (args[0] if args else kwargs.get("url", ""))
    assert kwargs["json"]["domain_connection"] == "AI tools"
    assert kwargs["json"]["domain_tags"] == ["ai", "saas"]
    assert result["domain_connection"] == "AI tools"


@pytest.mark.asyncio
async def test_search_chunks_posts_correct_body():
    client = make_client()
    http_mock = MagicMock()
    http_mock.post = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.search_chunks("customer success", limit=5)

    _, kwargs = http_mock.post.call_args
    assert kwargs["json"]["query"] == "customer success"
    assert kwargs["json"]["limit"] == 5
    assert "storage_key_prefix" not in kwargs["json"]


@pytest.mark.asyncio
async def test_search_chunks_includes_prefix_when_given():
    client = make_client()
    http_mock = MagicMock()
    http_mock.post = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.search_chunks("query", storage_key_prefix="applications/2026-05-01-acme/")

    _, kwargs = http_mock.post.call_args
    assert kwargs["json"]["storage_key_prefix"] == "applications/2026-05-01-acme/"


@pytest.mark.asyncio
async def test_find_similar_applications_posts_without_exclude():
    client = make_client()
    http_mock = MagicMock()
    http_mock.post = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.find_similar_applications("presales enterprise SaaS")

    _, kwargs = http_mock.post.call_args
    assert kwargs["json"]["query"] == "presales enterprise SaaS"
    assert "exclude_id" not in kwargs["json"]


@pytest.mark.asyncio
async def test_find_similar_applications_includes_exclude_id():
    client = make_client()
    http_mock = MagicMock()
    http_mock.post = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.find_similar_applications("query", exclude_id="app-uuid-99")

    _, kwargs = http_mock.post.call_args
    assert kwargs["json"]["exclude_id"] == "app-uuid-99"


@pytest.mark.asyncio
async def test_get_ingestion_history_default_params():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_ingestion_history()

    _, kwargs = http_mock.get.call_args
    assert kwargs["params"]["limit"] == 50
    assert "profile_slug" not in kwargs["params"]
    assert "outcome" not in kwargs["params"]


@pytest.mark.asyncio
async def test_get_ingestion_history_passes_filters():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_ingestion_history(profile_slug="presales-se", outcome="fit", limit=25)

    _, kwargs = http_mock.get.call_args
    assert kwargs["params"]["profile_slug"] == "presales-se"
    assert kwargs["params"]["outcome"] == "fit"
    assert kwargs["params"]["limit"] == 25


# ===========================================================================
# GET /api/tracker — domain fields
# ===========================================================================

TRACKER_ROW_WITH_DOMAIN = {
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
    "domain_connection": "Applicant built AI DevTools used in similar B2B workflows.",
    "domain_tags": ["ai-devtools", "b2b-saas"],
}


def test_tracker_ob1_includes_domain_connection(ob1_client):
    client, mock = ob1_client
    mock.get_tracker = AsyncMock(return_value=[TRACKER_ROW_WITH_DOMAIN])
    row = client.get("/api/tracker").json()["rows"][0]
    assert row["domain_connection"] == "Applicant built AI DevTools used in similar B2B workflows."


def test_tracker_ob1_includes_domain_tags(ob1_client):
    client, mock = ob1_client
    mock.get_tracker = AsyncMock(return_value=[TRACKER_ROW_WITH_DOMAIN])
    row = client.get("/api/tracker").json()["rows"][0]
    assert row["domain_tags"] == ["ai-devtools", "b2b-saas"]


def test_tracker_ob1_domain_fields_default_to_empty(ob1_client):
    """Rows without domain fields don't cause errors and return empty defaults."""
    client, mock = ob1_client
    mock.get_tracker = AsyncMock(return_value=[TRACKER_ROW])  # no domain fields
    row = client.get("/api/tracker").json()["rows"][0]
    assert row["domain_connection"] == ""
    assert row["domain_tags"] == []


# ===========================================================================
# GET /api/applications/{folder} — domain metadata pass-through
# ===========================================================================

def test_get_application_folder_ob1_includes_domain_fields(ob1_client):
    client, mock = ob1_client
    mock.list_files = AsyncMock(return_value=[
        {"key": "applications/2026-05-01-acme/notes.md", "size": 100},
    ])
    mock.get_application = AsyncMock(return_value={
        "id": "uuid-1",
        "domain_connection": "Applicant built payments infra for similar B2B scale.",
        "domain_tags": ["fintech", "b2b-saas"],
        "jd_requirements": {"required": ["5+ yrs Python"], "preferred": ["Kubernetes"]},
    })
    resp = client.get("/api/applications/2026-05-01-acme")
    assert resp.status_code == 200
    data = resp.json()
    assert data["domain_connection"] == "Applicant built payments infra for similar B2B scale."
    assert data["domain_tags"] == ["fintech", "b2b-saas"]
    assert data["jd_requirements"]["required"] == ["5+ yrs Python"]


def test_get_application_folder_ob1_domain_empty_when_app_record_none(ob1_client):
    """When get_application returns None, domain fields default to empty."""
    client, mock = ob1_client
    mock.list_files = AsyncMock(return_value=[
        {"key": "applications/2026-05-01-acme/notes.md", "size": 100},
    ])
    mock.get_application = AsyncMock(return_value=None)
    resp = client.get("/api/applications/2026-05-01-acme")
    assert resp.status_code == 200
    data = resp.json()
    assert data["domain_connection"] == ""
    assert data["domain_tags"] == []
    assert data["jd_requirements"] == {}


# ===========================================================================
# PATCH /api/applications/{folder}/fields — ob1 mode
# ===========================================================================

def test_patch_application_fields_ob1_happy_path(ob1_client):
    client, mock = ob1_client
    mock.get_application = AsyncMock(return_value={"id": "uuid-1", "company_name": "Acme"})
    mock.update_application_fields = AsyncMock(return_value={"id": "uuid-1", "domain_connection": "AI tools"})

    resp = client.patch(
        "/api/applications/2026-05-01-acme/fields",
        json={"domain_connection": "AI tools"},
    )
    assert resp.status_code == 200
    mock.get_application.assert_called_once_with("2026-05-01-acme")
    mock.update_application_fields.assert_called_once_with("uuid-1", domain_connection="AI tools")


def test_patch_application_fields_ob1_passes_domain_tags(ob1_client):
    client, mock = ob1_client
    mock.get_application = AsyncMock(return_value={"id": "uuid-2"})

    client.patch(
        "/api/applications/2026-05-01-acme/fields",
        json={"domain_tags": ["ai", "b2b"], "domain_connection": "Match"},
    )
    _, kwargs = mock.update_application_fields.call_args
    assert kwargs["domain_tags"] == ["ai", "b2b"]
    assert kwargs["domain_connection"] == "Match"


def test_patch_application_fields_ob1_ignores_unknown_keys(ob1_client):
    client, mock = ob1_client
    mock.get_application = AsyncMock(return_value={"id": "uuid-3"})

    client.patch(
        "/api/applications/2026-05-01-acme/fields",
        json={"domain_connection": "ok", "evil_field": "injected"},
    )
    _, kwargs = mock.update_application_fields.call_args
    assert "evil_field" not in kwargs


def test_patch_application_fields_ob1_app_not_found(ob1_client):
    client, mock = ob1_client
    mock.get_application = AsyncMock(return_value=None)

    resp = client.patch(
        "/api/applications/missing-folder/fields",
        json={"domain_connection": "anything"},
    )
    assert resp.status_code == 404
    mock.update_application_fields.assert_not_called()


def test_patch_application_fields_ob1_no_valid_fields_422(ob1_client):
    client, mock = ob1_client
    mock.get_application = AsyncMock(return_value={"id": "uuid-4"})

    resp = client.patch(
        "/api/applications/2026-05-01-acme/fields",
        json={"totally_unknown": "value"},
    )
    assert resp.status_code == 422
    mock.update_application_fields.assert_not_called()


def test_patch_application_fields_local_mode_returns_404(client):
    """Fields PATCH is OB1-only; returns 404 in local mode."""
    resp = client.patch(
        "/api/applications/2026-05-01-acme/fields",
        json={"domain_connection": "anything"},
    )
    assert resp.status_code == 404


# ===========================================================================
# POST /api/chunk-search
# ===========================================================================

def test_chunk_search_ob1_returns_results(ob1_client):
    client, mock = ob1_client
    chunk = {
        "storage_key": "applications/2026-05-01-acme/notes.md",
        "section_title": "Domain Connection",
        "section_index": 2,
        "content": "Applicant built similar tooling.",
        "similarity": 0.87,
    }
    mock.search_chunks = AsyncMock(return_value=[chunk])

    resp = client.post("/api/chunk-search", json={"query": "domain experience", "limit": 5})
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert len(results) == 1
    assert results[0]["similarity"] == 0.87
    mock.search_chunks.assert_called_once_with("domain experience", storage_key_prefix=None, limit=5)


def test_chunk_search_ob1_passes_prefix(ob1_client):
    client, mock = ob1_client
    client.post("/api/chunk-search", json={
        "query": "q", "storage_key_prefix": "applications/2026-05-01-acme/",
    })
    _, kwargs = mock.search_chunks.call_args
    assert kwargs["storage_key_prefix"] == "applications/2026-05-01-acme/"


def test_chunk_search_local_mode_returns_404(client):
    resp = client.post("/api/chunk-search", json={"query": "anything"})
    assert resp.status_code == 404


# ===========================================================================
# POST /api/similar-applications
# ===========================================================================

def test_similar_applications_ob1_returns_results(ob1_client):
    client, mock = ob1_client
    similar = {
        "id": "uuid-old",
        "company_name": "SimilarCo",
        "role_title": "Solutions Engineer",
        "domain_connection": "Also AI DevTools.",
        "domain_tags": ["ai-devtools"],
        "status": "applied",
        "similarity": 0.91,
    }
    mock.find_similar_applications = AsyncMock(return_value=[similar])

    resp = client.post("/api/similar-applications", json={"query": "AI developer tooling", "limit": 3})
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert len(results) == 1
    assert results[0]["company_name"] == "SimilarCo"
    mock.find_similar_applications.assert_called_once_with("AI developer tooling", exclude_id=None, limit=3)


def test_similar_applications_ob1_passes_exclude_id(ob1_client):
    client, mock = ob1_client
    client.post("/api/similar-applications", json={"query": "q", "exclude_id": "uuid-current"})
    _, kwargs = mock.find_similar_applications.call_args
    assert kwargs["exclude_id"] == "uuid-current"


def test_similar_applications_local_mode_returns_404(client):
    resp = client.post("/api/similar-applications", json={"query": "anything"})
    assert resp.status_code == 404


# ===========================================================================
# GET /api/ingestion-history
# ===========================================================================

INGESTION_RECORD = {
    "id": "rec-1",
    "company_name": "Acme Corp",
    "role_title": "Solutions Engineer",
    "profile_slug": "presales-se",
    "outcome": "fit",
    "no_fit_reason": None,
    "is_repost": False,
    "first_seen_at": None,
    "created_at": "2026-05-01T10:00:00",
}


def test_ingestion_history_ob1_returns_records(ob1_client):
    client, mock = ob1_client
    mock.get_ingestion_history = AsyncMock(return_value=[INGESTION_RECORD])

    resp = client.get("/api/ingestion-history")
    assert resp.status_code == 200
    records = resp.json()["records"]
    assert len(records) == 1
    assert records[0]["company_name"] == "Acme Corp"
    assert records[0]["outcome"] == "fit"


def test_ingestion_history_ob1_passes_profile_slug(ob1_client):
    client, mock = ob1_client
    client.get("/api/ingestion-history", params={"profile_slug": "presales-se"})
    mock.get_ingestion_history.assert_called_once_with(
        profile_slug="presales-se", outcome=None, limit=50, direct_only=False
    )


def test_ingestion_history_ob1_passes_outcome_filter(ob1_client):
    client, mock = ob1_client
    client.get("/api/ingestion-history", params={"outcome": "no-fit", "limit": 20})
    mock.get_ingestion_history.assert_called_once_with(
        profile_slug=None, outcome="no-fit", limit=20, direct_only=False
    )


def test_ingestion_history_ob1_caps_limit(ob1_client):
    client, mock = ob1_client
    client.get("/api/ingestion-history", params={"limit": 999})
    _, kwargs = mock.get_ingestion_history.call_args
    assert kwargs["limit"] == 200  # capped at 200


def test_ingestion_history_local_mode_returns_empty(client):
    """Local mode returns gracefully — no 4xx, just empty records."""
    resp = client.get("/api/ingestion-history")
    assert resp.status_code == 200
    assert resp.json() == {"records": []}


# ===========================================================================
# ObRestClient.get_search_runs — unit tests
# ===========================================================================

@pytest.mark.asyncio
async def test_get_search_runs_default_params():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_search_runs()

    _, kwargs = http_mock.get.call_args
    assert kwargs["params"]["limit"] == 20
    assert "profile_slug" not in kwargs["params"]
    assert "since" not in kwargs["params"]


@pytest.mark.asyncio
async def test_get_search_runs_passes_profile_slug():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_search_runs(profile_slug="presales-se")

    _, kwargs = http_mock.get.call_args
    assert kwargs["params"]["profile_slug"] == "presales-se"


@pytest.mark.asyncio
async def test_get_search_runs_passes_since():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_search_runs(since="2026-01-01")

    _, kwargs = http_mock.get.call_args
    assert kwargs["params"]["since"] == "2026-01-01"


@pytest.mark.asyncio
async def test_get_search_runs_omits_none_params():
    """None values for profile_slug and since must not appear in params."""
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_search_runs(profile_slug=None, since=None, limit=10)

    _, kwargs = http_mock.get.call_args
    assert "profile_slug" not in kwargs["params"]
    assert "since" not in kwargs["params"]
    assert kwargs["params"]["limit"] == 10


# ===========================================================================
# GET /api/search-runs — endpoint tests
# ===========================================================================

SEARCH_RUN_ROW = {
    "id": "run-1",
    "profile_slug": "presales-se",
    "query": "Solutions Engineer | Account Executive",
    "pages_fetched": 3,
    "total_results": 60,
    "new_after_dedup": 45,
    "screened": 44,
    "fit_count": 7,
    "fetch_failed_count": 1,
    "summary_key": "search/2026-05-01-120000-presales-se-summary.md",
    "run_at": "2026-05-01T12:00:00",
}


def test_search_runs_ob1_returns_records(ob1_client):
    client, mock = ob1_client
    mock.get_search_runs = AsyncMock(return_value=[SEARCH_RUN_ROW])

    resp = client.get("/api/search-runs")
    assert resp.status_code == 200
    records = resp.json()["records"]
    assert len(records) == 1
    assert records[0]["profile_slug"] == "presales-se"
    assert records[0]["fit_count"] == 7
    assert records[0]["fetch_failed_count"] == 1


def test_search_runs_ob1_passes_profile_slug(ob1_client):
    client, mock = ob1_client
    client.get("/api/search-runs", params={"profile_slug": "presales-se"})
    mock.get_search_runs.assert_called_once_with(
        profile_slug="presales-se", since=None, limit=20
    )


def test_search_runs_ob1_passes_since(ob1_client):
    client, mock = ob1_client
    client.get("/api/search-runs", params={"since": "2026-05-01"})
    mock.get_search_runs.assert_called_once_with(
        profile_slug=None, since="2026-05-01", limit=20
    )


def test_search_runs_ob1_caps_limit(ob1_client):
    client, mock = ob1_client
    client.get("/api/search-runs", params={"limit": 999})
    _, kwargs = mock.get_search_runs.call_args
    assert kwargs["limit"] == 200  # capped at 200


def test_search_runs_local_mode_returns_empty(client):
    """Local mode returns gracefully — no 4xx, just empty records."""
    resp = client.get("/api/search-runs")
    assert resp.status_code == 200
    assert resp.json() == {"records": []}


# ===========================================================================
# ObRestClient — /ob1/rest/* methods (merged from ob1-rest-pg)
# ===========================================================================

@pytest.mark.asyncio
async def test_get_thoughts_hits_ob1_rest_endpoint():
    """get_thoughts calls /ob1/rest/thoughts, not /api/v2/."""
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, {"thoughts": [], "total": 0}))
    client._client = http_mock

    await client.get_thoughts()

    url_called = http_mock.get.call_args[0][0]
    assert url_called == '/ob1/rest/thoughts'


@pytest.mark.asyncio
async def test_get_thoughts_passes_params():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, {"thoughts": [], "total": 0}))
    client._client = http_mock

    await client.get_thoughts(limit=10, offset=20, sort='asc', filter_type='email')

    _, kwargs = http_mock.get.call_args
    params = kwargs['params']
    # get_thoughts translates limit/offset/sort to the /ob1/rest/thoughts
    # query contract (per_page/page/order) — see job-search-server.ts.
    assert params['per_page'] == 10
    assert params['page'] == 3
    assert params['order'] == 'asc'
    assert params['type'] == 'email'


@pytest.mark.asyncio
async def test_get_thoughts_omits_filter_type_when_none():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, {"thoughts": [], "total": 0}))
    client._client = http_mock

    await client.get_thoughts(filter_type=None)

    _, kwargs = http_mock.get.call_args
    assert 'type' not in kwargs['params']


@pytest.mark.asyncio
async def test_get_thought_hits_correct_url():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, {"id": "42", "content": "test"}))
    client._client = http_mock

    await client.get_thought("42")

    url_called = http_mock.get.call_args[0][0]
    assert url_called == '/ob1/rest/thought/42'


@pytest.mark.asyncio
async def test_search_thoughts_posts_correct_body():
    client = make_client()
    http_mock = MagicMock()
    http_mock.post = AsyncMock(return_value=FakeResponse(200, {"results": [], "total": 0}))
    client._client = http_mock

    await client.search_thoughts("resume tips", limit=15, mode='keyword')

    _, kwargs = http_mock.post.call_args
    assert kwargs['json'] == {"query": "resume tips", "limit": 15, "mode": "keyword"}
    url_called = http_mock.post.call_args[0][0]
    assert url_called == '/ob1/rest/search'


@pytest.mark.asyncio
async def test_get_thought_stats_hits_ob1_rest_stats():
    client = make_client()
    http_mock = MagicMock()
    # /ob1/rest/stats returns total_thoughts/types (see job-search-server.ts);
    # get_thought_stats translates these to total/by_type.
    http_mock.get = AsyncMock(return_value=FakeResponse(200, {"total_thoughts": 5, "types": {"email": 2}}))
    client._client = http_mock

    result = await client.get_thought_stats()

    url_called = http_mock.get.call_args[0][0]
    assert url_called == '/ob1/rest/stats'
    assert result["total"] == 5
    assert result["by_type"] == {"email": 2}


@pytest.mark.asyncio
async def test_get_thought_connections_hits_correct_url():
    client = make_client()
    http_mock = MagicMock()
    http_mock.get = AsyncMock(return_value=FakeResponse(200, []))
    client._client = http_mock

    await client.get_thought_connections("99", limit=5)

    url_called = http_mock.get.call_args[0][0]
    assert url_called == '/ob1/rest/thought/99/connections'
    _, kwargs = http_mock.get.call_args
    assert kwargs['params']['limit'] == 5


# ===========================================================================
# GET /api/thoughts
# ===========================================================================

THOUGHT_ROW = {
    "id": "101",
    "content": "# Meeting notes\nGreat conversation with hiring manager.",
    "metadata": {"thought_category": "email", "company": "Acme"},
    "created_at": "2026-05-01T10:00:00",
}


def test_list_thoughts_ob1_returns_data(ob1_client):
    client, mock = ob1_client
    mock.get_thoughts = AsyncMock(return_value={"thoughts": [THOUGHT_ROW], "total": 1})

    resp = client.get("/api/thoughts")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["thoughts"][0]["id"] == "101"
    assert data["thoughts"][0]["metadata"]["company"] == "Acme"


def test_list_thoughts_passes_params_to_ob_rest(ob1_client):
    client, mock = ob1_client
    client.get("/api/thoughts", params={"limit": 10, "offset": 5, "sort": "asc", "type": "email"})
    mock.get_thoughts.assert_called_once_with(limit=10, offset=5, sort='asc', filter_type='email')


def test_list_thoughts_caps_limit_at_200(ob1_client):
    client, mock = ob1_client
    client.get("/api/thoughts", params={"limit": 999})
    _, kwargs = mock.get_thoughts.call_args
    assert kwargs["limit"] == 200


def test_list_thoughts_local_mode_returns_503(client):
    resp = client.get("/api/thoughts")
    assert resp.status_code == 503


# ===========================================================================
# GET /api/thoughts/stats
# ===========================================================================

def test_thoughts_stats_ob1_returns_stats(ob1_client):
    client, mock = ob1_client
    mock.get_thought_stats = AsyncMock(return_value={"total": 12, "by_type": {"email": 5, "note": 7}})

    resp = client.get("/api/thoughts/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 12
    assert data["by_type"]["email"] == 5


def test_thoughts_stats_local_mode_returns_503(client):
    resp = client.get("/api/thoughts/stats")
    assert resp.status_code == 503


# ===========================================================================
# GET /api/thoughts/{thought_id}
# ===========================================================================

def test_get_thought_ob1_returns_thought(ob1_client):
    client, mock = ob1_client
    mock.get_thought = AsyncMock(return_value=THOUGHT_ROW)

    resp = client.get("/api/thoughts/101")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "101"
    assert "Meeting notes" in data["content"]
    mock.get_thought.assert_called_once_with("101")


def test_get_thought_local_mode_returns_503(client):
    resp = client.get("/api/thoughts/101")
    assert resp.status_code == 503


# ===========================================================================
# GET /api/thoughts/{thought_id}/connections
# ===========================================================================

CONNECTION_ROW = {
    "id": "202",
    "content": "# Related thought",
    "metadata": {},
    "created_at": "2026-05-02T08:00:00",
}


def test_thought_connections_ob1_returns_connections(ob1_client):
    client, mock = ob1_client
    mock.get_thought_connections = AsyncMock(return_value=[CONNECTION_ROW])

    resp = client.get("/api/thoughts/101/connections")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == "202"
    mock.get_thought_connections.assert_called_once_with("101", limit=10)


def test_thought_connections_passes_limit_param(ob1_client):
    client, mock = ob1_client
    client.get("/api/thoughts/101/connections", params={"limit": 25})
    mock.get_thought_connections.assert_called_once_with("101", limit=25)


def test_thought_connections_local_mode_returns_503(client):
    resp = client.get("/api/thoughts/101/connections")
    assert resp.status_code == 503


# ===========================================================================
# POST /api/thoughts/search
# ===========================================================================

def test_search_thoughts_ob1_returns_results(ob1_client):
    client, mock = ob1_client
    mock.search_thoughts = AsyncMock(return_value={"results": [THOUGHT_ROW], "total": 1})

    resp = client.post("/api/thoughts/search", json={"query": "hiring manager", "limit": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["results"][0]["id"] == "101"
    mock.search_thoughts.assert_called_once_with(query="hiring manager", limit=5, mode="semantic")


def test_search_thoughts_passes_mode(ob1_client):
    client, mock = ob1_client
    client.post("/api/thoughts/search", json={"query": "q", "mode": "keyword"})
    _, kwargs = mock.search_thoughts.call_args
    assert kwargs["mode"] == "keyword"


def test_search_thoughts_caps_limit_at_100(ob1_client):
    client, mock = ob1_client
    client.post("/api/thoughts/search", json={"query": "q", "limit": 999})
    _, kwargs = mock.search_thoughts.call_args
    assert kwargs["limit"] == 100


def test_search_thoughts_local_mode_returns_503(client):
    resp = client.post("/api/thoughts/search", json={"query": "anything"})
    assert resp.status_code == 503
