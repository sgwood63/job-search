#!/usr/bin/env python3
"""
backfill-file-sizes.py — Fix js_files.file_size=0 by reading actual sizes from MinIO.

Queries js_files WHERE file_size IS NULL OR file_size = 0, calls stat_object for each
key to get the real size from MinIO, and UPDATEs js_files.file_size.

Re-runnable — only touches records still showing 0 or NULL.

Usage:
  python scripts/backfill-file-sizes.py [--dry-run]
"""

import argparse
import os
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

# ---------------------------------------------------------------------------
# Load .env and .env.services
# ---------------------------------------------------------------------------
def _load_env_file(path):
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line.startswith("export "):
                line = line[7:]
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip())

_root = Path(__file__).parent.parent
_load_env_file(_root / ".env")
_load_env_file(_root / ".env.services")

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
parser = argparse.ArgumentParser(description="Backfill js_files.file_size from MinIO")
parser.add_argument("--dry-run", action="store_true", help="Print plan, no writes")
args = parser.parse_args()

DRY_RUN = args.dry_run
BUCKET  = os.environ.get("MINIO_BUCKET", "job-search")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def get_db():
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
        dbname=os.environ.get("DB_NAME", "openbrain"),
        user=os.environ.get("DB_USER", "postgres"),
        password=os.environ.get("DB_PASSWORD", ""),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )

# ---------------------------------------------------------------------------
# MinIO client
# ---------------------------------------------------------------------------
def make_minio():
    from minio import Minio
    return Minio(
        os.environ.get("MINIO_ENDPOINT", "localhost:9000"),
        access_key=os.environ.get("MINIO_ACCESS_KEY", ""),
        secret_key=os.environ.get("MINIO_SECRET_KEY", ""),
        secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
    )

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    conn = get_db()
    mc   = make_minio()

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, storage_key FROM js_files WHERE file_size IS NULL OR file_size = 0"
            " ORDER BY storage_key"
        )
        rows = cur.fetchall()

    print(f"Found {len(rows)} record(s) with file_size = 0 or NULL")
    if not rows:
        print("Nothing to fix.")
        return

    fixed   = 0
    skipped = 0

    with conn.cursor() as cur:
        for row in rows:
            storage_key = row["storage_key"]
            row_id      = row["id"]
            try:
                stat = mc.stat_object(BUCKET, storage_key)
                size = stat.size
            except Exception as e:
                print(f"  SKIP  {storage_key} — stat_object failed: {e}", file=sys.stderr)
                skipped += 1
                continue

            if size == 0:
                print(f"  SKIP  {storage_key} — MinIO also reports 0 bytes (file may be genuinely empty)")
                skipped += 1
                continue

            if DRY_RUN:
                print(f"  DRY   {storage_key} — would set file_size = {size:,}")
            else:
                cur.execute(
                    "UPDATE js_files SET file_size = %s, updated_at = now() WHERE id = %s",
                    (size, row_id),
                )
                print(f"  FIXED {storage_key} — file_size = {size:,}")
            fixed += 1

        if not DRY_RUN:
            conn.commit()

    conn.close()
    action = "Would fix" if DRY_RUN else "Fixed"
    print(f"\n{action}: {fixed}, Skipped: {skipped}")

if __name__ == "__main__":
    main()
