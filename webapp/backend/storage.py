"""
Object store abstraction for the job search web app.
Backend is selected via OBJECT_STORE_BACKEND in .env:
  'minio'    — local Kubernetes MinIO (default)
  'supabase' — Supabase Storage (cloud)
"""

import asyncio
import mimetypes
import os
from abc import ABC, abstractmethod
from pathlib import Path
from urllib.parse import quote

import httpx


class ObjectStore(ABC):
    @abstractmethod
    async def put(self, key: str, content: bytes, content_type: str) -> None: ...

    @abstractmethod
    async def get(self, key: str) -> bytes: ...

    @abstractmethod
    async def list(self, prefix: str) -> list[dict]: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    @abstractmethod
    async def get_presigned_url(self, key: str, expires: int = 3600) -> str: ...


# ---------------------------------------------------------------------------
# MinIO backend (local Kubernetes)
# ---------------------------------------------------------------------------

class MinioStore(ObjectStore):
    def __init__(self):
        from minio import Minio
        from minio.commonconfig import ENABLED
        self._client = Minio(
            os.environ["MINIO_ENDPOINT"],
            access_key=os.environ["MINIO_ACCESS_KEY"],
            secret_key=os.environ["MINIO_SECRET_KEY"],
            secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
        )
        self._bucket = os.environ.get("MINIO_BUCKET", "job-search")
        self._ensure_bucket()

    def _ensure_bucket(self):
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)

    async def put(self, key: str, content: bytes, content_type: str) -> None:
        import io
        data = io.BytesIO(content)
        await asyncio.to_thread(
            self._client.put_object,
            self._bucket, key, data, len(content),
            content_type=content_type,
        )

    async def get(self, key: str) -> bytes:
        def _get():
            response = self._client.get_object(self._bucket, key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()
        return await asyncio.to_thread(_get)

    async def list(self, prefix: str) -> list[dict]:
        def _list():
            objects = self._client.list_objects(self._bucket, prefix=prefix, recursive=True)
            return [
                {
                    "key": obj.object_name,
                    "size": obj.size or 0,
                    "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
                }
                for obj in objects
            ]
        return await asyncio.to_thread(_list)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._client.remove_object, self._bucket, key)

    async def get_presigned_url(self, key: str, expires: int = 3600) -> str:
        from datetime import timedelta
        return await asyncio.to_thread(
            self._client.presigned_get_object,
            self._bucket, key, expires=timedelta(seconds=expires),
        )


# ---------------------------------------------------------------------------
# Supabase Storage backend (cloud)
# ---------------------------------------------------------------------------

class SupabaseStore(ObjectStore):
    def __init__(self):
        from supabase import create_client
        self._client = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_KEY"],
        )
        self._bucket = os.environ.get("SUPABASE_BUCKET", "job-search")

    async def put(self, key: str, content: bytes, content_type: str) -> None:
        self._client.storage.from_(self._bucket).upload(
            key, content,
            file_options={"content-type": content_type, "upsert": "true"},
        )

    async def get(self, key: str) -> bytes:
        return self._client.storage.from_(self._bucket).download(key)

    async def list(self, prefix: str) -> list[dict]:
        parts = prefix.rstrip("/").rsplit("/", 1)
        folder = parts[0] if len(parts) > 1 else ""
        items = self._client.storage.from_(self._bucket).list(folder)
        return [
            {
                "key": f"{folder}/{item['name']}" if folder else item["name"],
                "size": item.get("metadata", {}).get("size", 0),
                "last_modified": item.get("updated_at"),
            }
            for item in items
            if (f"{folder}/{item['name']}" if folder else item["name"]).startswith(prefix)
        ]

    async def delete(self, key: str) -> None:
        self._client.storage.from_(self._bucket).remove([key])

    async def get_presigned_url(self, key: str, expires: int = 3600) -> str:
        result = self._client.storage.from_(self._bucket).create_signed_url(key, expires)
        return result["signedURL"]


# ---------------------------------------------------------------------------
# Local filesystem backend
# ---------------------------------------------------------------------------

class LocalStore(ObjectStore):
    """Reads/writes files directly from APPLICANT_DIR on the local filesystem."""

    def __init__(self):
        raw = os.environ.get("APPLICANT_DIR", "")
        self._root = Path(raw.strip('"').strip("'"))

    async def put(self, key: str, content: bytes, content_type: str) -> None:
        path = self._root / key
        await asyncio.to_thread(lambda: (path.parent.mkdir(parents=True, exist_ok=True), path.write_bytes(content)))

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread((self._root / key).read_bytes)

    async def list(self, prefix: str) -> list[dict]:
        base = self._root / prefix
        if not base.exists():
            return []
        def _scan():
            results = []
            root = self._root
            target = self._root / prefix
            if target.is_file():
                return [{"key": prefix, "size": target.stat().st_size}]
            for p in sorted(target.rglob("*")):
                if p.is_file():
                    results.append({"key": str(p.relative_to(root)), "size": p.stat().st_size})
            return results
        return await asyncio.to_thread(_scan)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread((self._root / key).unlink)

    async def get_presigned_url(self, key: str, expires: int = 3600) -> str:
        # Local mode has no presigning — return the API path so callers still get a usable URL.
        return f"/api/file?path={quote(key)}"


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_store: ObjectStore | None = None


def make_store() -> ObjectStore:
    global _store
    if _store is None:
        data_backend = os.environ.get("DATA_BACKEND", "local").lower()
        if data_backend == "ob1":
            object_backend = os.environ.get("OBJECT_STORE_BACKEND", "minio").lower()
            if object_backend == "supabase":
                _store = SupabaseStore()
            else:
                _store = MinioStore()
        else:
            _store = LocalStore()
    return _store
