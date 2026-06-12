#!/usr/bin/env python3
"""
backfill-thoughts.py — Generate embeddings for migrated files that lack a thought_id.

Steps:
  A. For every js_files row with thought_id IS NULL and a text content_type,
     fetch content from MinIO, call the embedding + metadata APIs, insert into
     thoughts, and update js_files.thought_id.
  B. Wire js_applications.jd_thought_id / notes_thought_id from js_files using
     folder_prefix pattern matching.
  C. Wire js_search_runs.summary_thought_id from js_files.storage_key.

Re-runnable — skips files that already have a thought_id.

Usage:
  python scripts/backfill-thoughts.py [--dry-run] [--only-fk] [--limit N] [--delay SECS]

Environment (loaded from .env and .env.services):
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD        ← .env.services
  OBJECT_STORE_BACKEND, MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET  ← .env.services
  EMBEDDING_API_BASE, EMBEDDING_API_KEY (or LLM_API_KEY), EMBEDDING_MODEL  ← .env.services
  CHAT_API_BASE, CHAT_API_KEY (or LLM_API_KEY), CHAT_MODEL                 ← .env.services
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
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
parser = argparse.ArgumentParser(description="Backfill thought embeddings for migrated files")
parser.add_argument("--dry-run", action="store_true", help="Print plan, no writes")
parser.add_argument("--only-fk", action="store_true", help="Skip embedding step, only wire FK columns")
parser.add_argument("--limit", type=int, default=0, help="Max files to embed (0 = all)")
parser.add_argument("--delay", type=float, default=0.2, help="Seconds between API calls (default 0.2)")
args = parser.parse_args()

DRY_RUN  = args.dry_run
ONLY_FK  = args.only_fk
LIMIT    = args.limit
DELAY    = args.delay

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
EMBEDDING_API_BASE = os.environ.get("EMBEDDING_API_BASE", "https://api.openai.com/v1").strip()
EMBEDDING_API_KEY  = (os.environ.get("EMBEDDING_API_KEY") or os.environ.get("LLM_API_KEY") or "").strip()
EMBEDDING_MODEL    = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small").strip()

CHAT_API_BASE = os.environ.get("CHAT_API_BASE", EMBEDDING_API_BASE).strip()
CHAT_API_KEY  = (os.environ.get("CHAT_API_KEY") or os.environ.get("LLM_API_KEY") or "").strip()
CHAT_MODEL    = os.environ.get("CHAT_MODEL", "gpt-4o-mini").strip()

BUCKET = os.environ.get("MINIO_BUCKET", "job-search")

TEXT_TYPES     = {"text/markdown", "text/plain", "application/json"}
MIN_SIZE       = 50      # bytes — matches upload_file threshold
MAX_EMBED_CHARS = 25_000  # ~6,000 tokens — safely under text-embedding-3-small's 8,191 limit

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
# API helpers
# ---------------------------------------------------------------------------
def _post_json(url: str, key: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get_embedding(text: str) -> list[float]:
    d = _post_json(
        f"{EMBEDDING_API_BASE}/embeddings",
        EMBEDDING_API_KEY,
        {"model": EMBEDDING_MODEL, "input": text},
    )
    return d["data"][0]["embedding"]


def summarize_for_embedding(content: str) -> str:
    d = _post_json(
        f"{CHAT_API_BASE}/chat/completions",
        CHAT_API_KEY,
        {
            "model": CHAT_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Summarize this document in 3-5 sentences for semantic search indexing. "
                        "Focus on what it contains and why someone would search for it."
                    ),
                },
                {"role": "user", "content": content[:80_000]},
            ],
        },
    )
    return d["choices"][0]["message"]["content"]


def extract_metadata(text: str) -> dict:
    try:
        d = _post_json(
            f"{CHAT_API_BASE}/chat/completions",
            CHAT_API_KEY,
            {
                "model": CHAT_MODEL,
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Extract metadata from the user's captured thought. Return JSON with:\n"
                            '- "people": array of people mentioned (empty if none)\n'
                            '- "action_items": array of implied to-dos (empty if none)\n'
                            '- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)\n'
                            '- "topics": array of 1-3 short topic tags (always at least one)\n'
                            '- "type": one of "observation", "task", "idea", "reference", "person_note"\n'
                            "Only extract what's explicitly there."
                        ),
                    },
                    {"role": "user", "content": text},
                ],
            },
        )
        return json.loads(d["choices"][0]["message"]["content"])
    except Exception:
        return {"topics": ["uncategorized"], "type": "observation"}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
def log(msg: str):
    print(f"  {'[DRY RUN] ' if DRY_RUN else ''}{msg}", flush=True)

# ---------------------------------------------------------------------------
# Step A — embed un-indexed text files
# ---------------------------------------------------------------------------
def backfill_embeddings(cur, mc):
    print("\n[A] Embedding un-indexed text files …")

    cur.execute(
        """SELECT id, storage_key, content_type, file_size
           FROM js_files
           WHERE thought_id IS NULL
             AND content_type = ANY(%s)
             AND file_size > %s
           ORDER BY storage_key""",
        (list(TEXT_TYPES), MIN_SIZE),
    )
    rows = cur.fetchall()

    if LIMIT:
        rows = rows[:LIMIT]

    print(f"  Found {len(rows)} files to embed")
    if not rows:
        return

    embedded = 0
    errors   = 0

    for row in rows:
        file_id     = row["id"]
        storage_key = row["storage_key"]

        try:
            # Fetch from MinIO
            resp = mc.get_object(BUCKET, storage_key)
            content = resp.read().decode("utf-8", errors="replace")
            resp.close()
            resp.release_conn()

            if len(content.strip()) < MIN_SIZE:
                log(f"SKIP (too short after decode): {storage_key}")
                continue

            large = len(content) > MAX_EMBED_CHARS

            if DRY_RUN:
                label = "summarize+embed" if large else "embed"
                log(f"would {label}: {storage_key} ({len(content)} chars)")
                embedded += 1
                continue

            embed_text = summarize_for_embedding(content) if large else content
            embedding  = get_embedding(embed_text)
            metadata   = extract_metadata(embed_text)
            metadata["source"]      = "job-search-mcp"
            metadata["storage_key"] = storage_key
            if large:
                metadata["summarized"] = True

            emb_str = "[" + ",".join(str(v) for v in embedding) + "]"

            cur.execute(
                "INSERT INTO thoughts (content, embedding, metadata) VALUES (%s, %s::vector, %s::jsonb) RETURNING id",
                (content, emb_str, json.dumps(metadata)),
            )
            thought_id = cur.fetchone()["id"]

            cur.execute(
                "UPDATE js_files SET thought_id = %s WHERE id = %s",
                (thought_id, file_id),
            )

            log(f"embedded: {storage_key} → thought {thought_id}")
            embedded += 1

            if DELAY:
                time.sleep(DELAY)

        except Exception as e:
            print(f"  ERROR {storage_key}: {e}", file=sys.stderr)
            errors += 1

    print(f"  Embedded: {embedded}, Errors: {errors}")

# ---------------------------------------------------------------------------
# Step B — wire js_applications FK columns
# ---------------------------------------------------------------------------
def wire_application_fks(cur):
    print("\n[B] Wiring js_applications.jd_thought_id / notes_thought_id …")

    if DRY_RUN:
        # Show what would be updated
        cur.execute(
            """SELECT a.id, a.folder_prefix,
                      (SELECT f.thought_id FROM js_files f
                       WHERE (f.storage_key LIKE a.folder_prefix || 'jd-%'
                           OR f.storage_key = a.folder_prefix || 'job-description.md')
                         AND f.thought_id IS NOT NULL
                       ORDER BY f.storage_key LIMIT 1) AS new_jd_thought,
                      (SELECT f.thought_id FROM js_files f
                       WHERE f.storage_key = a.folder_prefix || 'notes.md'
                         AND f.thought_id IS NOT NULL
                       LIMIT 1) AS new_notes_thought
               FROM js_applications a
               WHERE a.folder_prefix IS NOT NULL
                 AND (a.jd_thought_id IS NULL OR a.notes_thought_id IS NULL)"""
        )
        rows = cur.fetchall()
        for r in rows:
            log(f"would update app {r['id']} ({r['folder_prefix']}): "
                f"jd_thought={r['new_jd_thought']}, notes_thought={r['new_notes_thought']}")
        print(f"  Would update {len(rows)} applications")
        return

    # jd_thought_id — first matching jd-*.md or job-description.md under folder_prefix
    cur.execute(
        """UPDATE js_applications a
           SET jd_thought_id = (
               SELECT f.thought_id FROM js_files f
               WHERE (f.storage_key LIKE a.folder_prefix || 'jd-%'
                   OR f.storage_key = a.folder_prefix || 'job-description.md')
                 AND f.thought_id IS NOT NULL
               ORDER BY f.storage_key
               LIMIT 1
           )
           WHERE a.folder_prefix IS NOT NULL
             AND a.jd_thought_id IS NULL"""
    )
    jd_count = cur.rowcount
    log(f"jd_thought_id: updated {jd_count} rows")

    # notes_thought_id
    cur.execute(
        """UPDATE js_applications a
           SET notes_thought_id = (
               SELECT f.thought_id FROM js_files f
               WHERE f.storage_key = a.folder_prefix || 'notes.md'
                 AND f.thought_id IS NOT NULL
               LIMIT 1
           )
           WHERE a.folder_prefix IS NOT NULL
             AND a.notes_thought_id IS NULL"""
    )
    notes_count = cur.rowcount
    log(f"notes_thought_id: updated {notes_count} rows")

# ---------------------------------------------------------------------------
# Step C — wire js_search_runs.summary_thought_id
# ---------------------------------------------------------------------------
def wire_search_run_fks(cur):
    print("\n[C] Wiring js_search_runs.summary_thought_id …")

    if DRY_RUN:
        cur.execute(
            """SELECT r.id, r.summary_key, f.thought_id
               FROM js_search_runs r
               JOIN js_files f ON f.storage_key = r.summary_key
               WHERE r.summary_thought_id IS NULL
                 AND r.summary_key IS NOT NULL
                 AND f.thought_id IS NOT NULL"""
        )
        rows = cur.fetchall()
        for r in rows:
            log(f"would update search_run {r['id']} → thought {r['thought_id']}")
        print(f"  Would update {len(rows)} search runs")
        return

    cur.execute(
        """UPDATE js_search_runs r
           SET summary_thought_id = f.thought_id
           FROM js_files f
           WHERE f.storage_key = r.summary_key
             AND r.summary_thought_id IS NULL
             AND r.summary_key IS NOT NULL
             AND f.thought_id IS NOT NULL"""
    )
    log(f"summary_thought_id: updated {cur.rowcount} rows")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("OB1 Thought Backfill")
    print("=" * 60)
    print(f"DRY_RUN:  {DRY_RUN}")
    print(f"ONLY_FK:  {ONLY_FK}")
    print(f"LIMIT:    {LIMIT or 'all'}")
    print(f"DELAY:    {DELAY}s")

    conn = None
    try:
        conn = get_db()
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        if not ONLY_FK:
            mc = make_minio()
            backfill_embeddings(cur, mc)
            if not DRY_RUN:
                conn.commit()
                print("\n  ✓ Embeddings committed.")

        wire_application_fks(cur)
        wire_search_run_fks(cur)

        if not DRY_RUN:
            conn.commit()
            print("\n✓ FK wiring committed.")
        else:
            print("\n✓ Dry run complete — no writes made.")

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"\n✗ Backfill failed: {e}", file=sys.stderr)
        raise
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
