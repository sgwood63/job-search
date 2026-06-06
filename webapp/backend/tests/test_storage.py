import os
import pytest
from pathlib import Path


# ---------------------------------------------------------------------------
# LocalStore — CRUD
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_put_get_roundtrip(local_store, tmp_applicant):
    content = b"hello world"
    await local_store.put("test.txt", content, "text/plain")
    result = await local_store.get("test.txt")
    assert result == content


@pytest.mark.asyncio
async def test_put_creates_parent_dirs(local_store, tmp_applicant):
    await local_store.put("applications/2026-01-01-co/notes.md", b"# Notes", "text/markdown")
    path = tmp_applicant / "applications" / "2026-01-01-co" / "notes.md"
    assert path.exists()
    assert path.read_bytes() == b"# Notes"


@pytest.mark.asyncio
async def test_get_missing_file_raises(local_store):
    with pytest.raises(Exception):
        await local_store.get("does-not-exist.txt")


@pytest.mark.asyncio
async def test_list_empty_prefix(local_store):
    result = await local_store.list("nonexistent-prefix")
    assert result == []


@pytest.mark.asyncio
async def test_list_returns_files(local_store, tmp_applicant):
    (tmp_applicant / "applications" / "2026-05-01-acme").mkdir(parents=True)
    (tmp_applicant / "applications" / "2026-05-01-acme" / "notes.md").write_bytes(b"notes")
    (tmp_applicant / "applications" / "2026-05-01-acme" / "resume.md").write_bytes(b"resume")

    result = await local_store.list("applications/2026-05-01-acme")
    keys = [r["key"] for r in result]
    assert any("notes.md" in k for k in keys)
    assert any("resume.md" in k for k in keys)


@pytest.mark.asyncio
async def test_list_single_file(local_store, tmp_applicant):
    (tmp_applicant / "applicant.md").write_bytes(b"# Applicant")
    result = await local_store.list("applicant.md")
    assert len(result) == 1
    assert result[0]["key"] == "applicant.md"
    assert result[0]["size"] > 0


@pytest.mark.asyncio
async def test_delete_removes_file(local_store, tmp_applicant):
    path = tmp_applicant / "temp.txt"
    path.write_bytes(b"to delete")
    await local_store.delete("temp.txt")
    assert not path.exists()


@pytest.mark.asyncio
async def test_presigned_url_format(local_store):
    url = await local_store.get_presigned_url("applications/2026-01-01/notes.md")
    assert url.startswith("/api/file?path=")
    assert "applications" in url


# ---------------------------------------------------------------------------
# make_store factory
# ---------------------------------------------------------------------------

def test_make_store_local(monkeypatch):
    import storage as storage_mod
    from storage import LocalStore
    storage_mod._store = None
    monkeypatch.setenv("DATA_BACKEND", "local")
    store = storage_mod.make_store()
    assert isinstance(store, LocalStore)
    storage_mod._store = None


def test_make_store_returns_singleton(monkeypatch):
    import storage as storage_mod
    storage_mod._store = None
    monkeypatch.setenv("DATA_BACKEND", "local")
    s1 = storage_mod.make_store()
    s2 = storage_mod.make_store()
    assert s1 is s2
    storage_mod._store = None


def test_make_store_reset_gives_new_instance(monkeypatch):
    import storage as storage_mod
    storage_mod._store = None
    monkeypatch.setenv("DATA_BACKEND", "local")
    s1 = storage_mod.make_store()
    storage_mod._store = None
    s2 = storage_mod.make_store()
    assert s1 is not s2
    storage_mod._store = None
