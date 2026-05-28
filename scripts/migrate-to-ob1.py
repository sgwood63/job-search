#!/usr/bin/env python3
"""
migrate-to-ob1.py — One-time migration from APPLICANT_DIR filesystem to OB1.

Migrates:
  1. js_applicant      ← applicant.md
  2. js_profiles       ← profiles/PROFILES-QUICK-REFERENCE.md
  3. js_experience     ← profiles/EXPERIENCE-REFERENCE.md
  4. js_companies      ← company names from application-tracker.md
  5. js_applications   ← application-tracker.md (full pipeline)
  6. js_contacts       ← memory/APPLICANT-MEMORY.md warm connections table
  7. js_search_runs    ← search/search-log.csv
  8. Object store      ← all files uploaded to MinIO/Supabase
  9. js_files          ← metadata records for every uploaded file

Run after OB1 Kubernetes deployment and job-search-schema.sql are applied.
Idempotent — safe to re-run; all inserts use ON CONFLICT DO UPDATE.

Usage:
  python scripts/migrate-to-ob1.py [--dry-run] [--skip-files] [--only-sql]

Environment (loaded from .env):
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
  OBJECT_STORE_BACKEND, MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET
  APPLICANT_DIR, APP_DIR
"""

import argparse
import csv
import json
import mimetypes
import os
import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import psycopg2
import psycopg2.extras

# ---------------------------------------------------------------------------
# Load env
# ---------------------------------------------------------------------------
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:]
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"'))

APPLICANT_DIR = Path(os.environ["APPLICANT_DIR"])
APP_DIR = Path(os.environ["APP_DIR"])

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
parser = argparse.ArgumentParser(description="Migrate APPLICANT_DIR to OB1")
parser.add_argument("--dry-run", action="store_true", help="Print what would happen, no writes")
parser.add_argument("--skip-files", action="store_true", help="Skip object store upload (SQL migration only)")
parser.add_argument("--only-sql", action="store_true", help="Alias for --skip-files")
parser.add_argument("--repair-folder-prefix", action="store_true",
                    help="Fix folder_prefix mismatches in js_applications using js_files as ground truth")
args = parser.parse_args()

DRY_RUN = args.dry_run
SKIP_FILES = args.skip_files or args.only_sql

# ---------------------------------------------------------------------------
# Database connection
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
# Object store client
# ---------------------------------------------------------------------------
def make_store():
    backend = os.environ.get("OBJECT_STORE_BACKEND", "minio").lower()
    if backend == "supabase":
        from supabase import create_client
        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
        bucket = os.environ.get("SUPABASE_BUCKET", "job-search")

        def upload(key: str, content: bytes, content_type: str):
            client.storage.from_(bucket).upload(
                key, content,
                file_options={"content-type": content_type, "upsert": "true"},
            )
        return upload
    else:
        from minio import Minio
        mc = Minio(
            os.environ.get("MINIO_ENDPOINT", "localhost:9000"),
            access_key=os.environ.get("MINIO_ACCESS_KEY", ""),
            secret_key=os.environ.get("MINIO_SECRET_KEY", ""),
            secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
        )
        bucket = os.environ.get("MINIO_BUCKET", "job-search")
        if not mc.bucket_exists(bucket):
            mc.make_bucket(bucket)

        import io
        def upload(key: str, content: bytes, content_type: str):
            mc.put_object(bucket, key, io.BytesIO(content), len(content), content_type=content_type)
        return upload

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

def guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(path.name)
    return mime or ("text/plain" if path.suffix in (".md", ".txt", ".csv") else "application/octet-stream")

SKIP_KEYS = {".env", ".auth", "seen-jobs.json", "__pycache__"}
def should_skip(path: Path) -> bool:
    return any(part in SKIP_KEYS for part in path.parts)

def log(msg: str):
    print(f"  {'[DRY RUN] ' if DRY_RUN else ''}{msg}", flush=True)

# ---------------------------------------------------------------------------
# Step 1: js_applicant
# ---------------------------------------------------------------------------
def migrate_applicant(cur):
    print("\n[1] Migrating js_applicant from applicant.md …")
    text = (APPLICANT_DIR / "applicant.md").read_text()

    # Extract fields via simple heuristics
    def find(pattern, default=""):
        m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        return m.group(1).strip() if m else default

    name = find(r"(?:name|applicant)[:\s]+(.+)")
    email = find(r"(?:email)[:\s]+([\w.+@]+\.[a-z]{2,})")
    city = find(r"(?:city|location city)[:\s]+([^,\n]+)")
    state = find(r"(?:state)[:\s]+([A-Z]{2})")
    remote = "remote-only" if re.search(r"remote.?only", text, re.I) else (
        "hybrid-ok" if re.search(r"hybrid", text, re.I) else "onsite-ok"
    )
    travel = int(t.group(1)) if (t := re.search(r"travel[^:]*:\s*(\d+)%", text, re.I)) else None
    comp_floor = int(c.group(1).replace(",", "")) if (
        c := re.search(r"(?:floor|minimum)[^$]*\$?([\d,]+)k?", text, re.I)
    ) else None

    if not DRY_RUN:
        cur.execute(
            """INSERT INTO js_applicant
               (display_name, email, location_city, location_state,
                remote_preference, travel_max_pct, comp_floor)
               VALUES (%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (id) DO NOTHING""",
            (name or os.environ.get("APPLICANT_NAME", "Unknown"),
             email or None, city or None, state or None,
             remote, travel, comp_floor)
        )
    log(f"applicant: {name or 'parsed'}")

# ---------------------------------------------------------------------------
# Step 2: js_profiles
# ---------------------------------------------------------------------------
def migrate_profiles(cur):
    print("\n[2] Migrating js_profiles from PROFILES-QUICK-REFERENCE.md …")
    ref_path = APPLICANT_DIR / "profiles" / "PROFILES-QUICK-REFERENCE.md"
    if not ref_path.exists():
        print("  SKIP — file not found")
        return

    text = ref_path.read_text()
    # Parse markdown table rows (skip header rows)
    rows = []
    for line in text.splitlines():
        if not line.startswith("|") or "---" in line or "Profile" in line:
            continue
        cols = [c.strip() for c in line.split("|")[1:-1]]
        if len(cols) >= 2:
            rows.append(cols)

    for cols in rows:
        profile_name = cols[0] if cols else ""
        if not profile_name or profile_name.lower() in ("profile", "name"):
            continue
        s = slug(profile_name)
        keywords = [k.strip() for k in cols[1].split(",")][:20] if len(cols) > 1 else []
        avoid = cols[2].strip() if len(cols) > 2 else ""
        query = cols[-1].strip() if len(cols) > 3 else ""

        if not DRY_RUN:
            cur.execute(
                """INSERT INTO js_profiles
                   (slug, display_name, jd_signal_keywords, avoid_when, search_query)
                   VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT (slug) DO UPDATE SET
                     display_name = EXCLUDED.display_name,
                     jd_signal_keywords = EXCLUDED.jd_signal_keywords,
                     avoid_when = EXCLUDED.avoid_when,
                     search_query = EXCLUDED.search_query,
                     updated_at = now()""",
                (s, profile_name, keywords or None, avoid or None, query or None)
            )
        log(f"profile: {s}")

# ---------------------------------------------------------------------------
# Step 3: js_experience
# ---------------------------------------------------------------------------
def migrate_experience(cur):
    print("\n[3] Migrating js_experience from EXPERIENCE-REFERENCE.md …")
    ref_path = APPLICANT_DIR / "profiles" / "EXPERIENCE-REFERENCE.md"
    if not ref_path.exists():
        print("  SKIP — file not found")
        return

    text = ref_path.read_text()
    # Find role blocks by "## Company / Title" or table patterns
    # Simple parse: look for lines with "**Company:**" or similar
    role_blocks = re.split(r"^#{2,3}\s+", text, flags=re.MULTILINE)
    order = 0
    for block in role_blocks:
        if not block.strip():
            continue
        lines = block.strip().splitlines()
        header = lines[0].strip() if lines else ""
        if not header or len(header) > 100:
            continue

        def find_field(pattern):
            m = re.search(pattern, block, re.IGNORECASE | re.MULTILINE)
            return m.group(1).strip() if m else None

        company = find_field(r"\*\*Company\*\*[:\s]+(.+)") or header
        title = find_field(r"\*\*Title\*\*[:\s]+(.+)") or ""
        classification = find_field(r"\*\*Role Classification\*\*[:\s]+(.+)") or "include-standard"
        bullets = re.findall(r"^[-*]\s+(.+)", block, re.MULTILINE)

        if not company or not title:
            continue

        achievements = [{"bullet": b, "profile_tags": [], "verified": True} for b in bullets]

        if not DRY_RUN:
            cur.execute(
                """INSERT INTO js_experience
                   (company, title, role_classification, achievements, sort_order)
                   VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT DO NOTHING""",
                (company, title, classification,
                 psycopg2.extras.Json(achievements), order)
            )
        log(f"experience: {company} / {title}")
        order += 10

# ---------------------------------------------------------------------------
# Step 4 + 5: js_companies + js_applications from application-tracker.md
# ---------------------------------------------------------------------------
def migrate_applications(cur):
    print("\n[4+5] Migrating js_companies + js_applications from application-tracker.md …")
    tracker = APPLICANT_DIR / "application-tracker.md"
    if not tracker.exists():
        print("  SKIP — tracker not found")
        return

    text = tracker.read_text()
    rows = []
    header_found = False
    col_map: dict = {}
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cols = [c.strip() for c in line.split("|")[1:-1]]
        if "---" in line:
            continue
        if not header_found and any("company" in c.lower() for c in cols):
            header_found = True
            col_map = {c.lower(): i for i, c in enumerate(cols)}
            continue
        if header_found and cols:
            rows.append(cols)

    def col(row, name, default=""):
        return row[col_map[name]].strip() if name in col_map and col_map[name] < len(row) else default

    STATUS_MAP = {
        "resume ready": "resume-ready",
        "applied": "applied",
        "interview scheduled": "interview-scheduled",
        "interviewed": "interviewed",
        "exercise": "exercise",
        "offer": "offer",
        "closed": "closed",
        "pending review": "pending-review",
        "rejected": "closed",
        "no fit": "closed",
    }

    app_count = 0
    for row in rows:
        if not any(c.strip() for c in row):
            continue

        company_name = col(row, "company") or col(row, "company / role")
        role = col(row, "role")
        if not company_name and not role:
            continue

        raw_status = col(row, "status", "pending-review").lower()
        status = next((v for k, v in STATUS_MAP.items() if k in raw_status), "closed")

        raw_date = col(row, "date")
        applied_date = None
        try:
            if raw_date:
                applied_date = datetime.strptime(raw_date.replace("/", "-"), "%Y-%m-%d").date()
        except ValueError:
            pass

        priority_raw = col(row, "priority", "")
        priority = 3 if "⭐️⭐️⭐️" in priority_raw or "3" in priority_raw else (
            2 if "⭐️⭐️" in priority_raw or "2" in priority_raw else 1
        )

        profile_slug_raw = col(row, "profile", "")
        source_url = col(row, "source", "") or col(row, "url", "")
        status_detail = col(row, "status detail", "") or col(row, "notes", "")

        folder_date = applied_date.strftime("%Y-%m-%d") if applied_date else "2026-01-01"
        company_slug = slug(company_name) if company_name else "unknown"
        role_slug = slug(role) if role else "role"
        computed = f"{folder_date}-{company_slug}-{role_slug}"

        # Use actual folder from disk to avoid slugification mismatches between
        # tracker data and the name Claude chose when creating the folder.
        apps_dir = APPLICANT_DIR / "applications"
        date_co_prefix = f"{folder_date}-{company_slug}"
        matches: list = []
        if apps_dir.is_dir():
            matches = [d.name for d in apps_dir.iterdir()
                       if d.is_dir() and d.name.startswith(date_co_prefix)]
        if len(matches) == 1:
            folder_prefix = f"applications/{matches[0]}/"
        elif len(matches) > 1:
            best = min(matches, key=lambda m: abs(len(m) - len(computed)))
            folder_prefix = f"applications/{best}/"
            log(f"WARNING: multiple folder matches for {company_name}/{role}, using {best}")
        else:
            folder_prefix = f"applications/{computed}/"
            if apps_dir.is_dir():
                log(f"WARNING: no folder found for {company_name}/{role}, using computed prefix")

        co_slug = slug(company_name) if company_name else "unknown"

        if not DRY_RUN:
            # Upsert company
            cur.execute(
                """INSERT INTO js_companies (name, slug)
                   VALUES (%s,%s)
                   ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name""",
                (company_name, co_slug)
            )
            cur.execute("SELECT id FROM js_companies WHERE slug = %s", (co_slug,))
            company_id = cur.fetchone()["id"]

            # Resolve profile_id
            profile_id = None
            if profile_slug_raw:
                ps = slug(profile_slug_raw)
                cur.execute("SELECT id FROM js_profiles WHERE slug = %s", (ps,))
                row_p = cur.fetchone()
                profile_id = row_p["id"] if row_p else None

            # Follow-up date: applied + 14 days
            follow_up = None
            if applied_date and status == "applied":
                from datetime import timedelta
                follow_up = applied_date + timedelta(days=14)

            cur.execute(
                """INSERT INTO js_applications
                   (company_id, company_name_raw, role_title, profile_id, source_url,
                    folder_prefix, status, status_detail, applied_date, follow_up_date, priority)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT DO NOTHING""",
                (company_id, company_name, role, profile_id,
                 source_url or None, folder_prefix, status,
                 status_detail or None, applied_date, follow_up, priority)
            )
        log(f"application: {company_name} / {role} → {status}")
        app_count += 1

    print(f"  Total applications: {app_count}")

# ---------------------------------------------------------------------------
# Step 6: js_contacts from APPLICANT-MEMORY.md
# ---------------------------------------------------------------------------
def migrate_contacts(cur):
    print("\n[6] Migrating js_contacts from APPLICANT-MEMORY.md …")
    mem = APPLICANT_DIR / "memory" / "APPLICANT-MEMORY.md"
    if not mem.exists():
        print("  SKIP — file not found")
        return

    text = mem.read_text()
    # Look for markdown tables that contain contact-like columns
    table_blocks = re.findall(r"(\|.+\|(?:\n\|.+\|)+)", text)
    for block in table_blocks:
        rows = [
            [c.strip() for c in line.split("|")[1:-1]]
            for line in block.splitlines()
            if line.startswith("|") and "---" not in line
        ]
        if len(rows) < 2:
            continue
        header = [h.lower() for h in rows[0]]
        if not any(h in ("name", "contact", "person") for h in header):
            continue

        def hcol(row, names):
            for n in names:
                if n in header and header.index(n) < len(row):
                    return row[header.index(n)].strip()
            return ""

        for data_row in rows[1:]:
            name = hcol(data_row, ["name", "contact", "person"])
            company = hcol(data_row, ["company", "org", "organization"])
            title = hcol(data_row, ["title", "role", "position"])
            rel = hcol(data_row, ["type", "relationship", "relation"])
            notes = hcol(data_row, ["notes", "connection", "detail"])

            if not name:
                continue

            rel_type = "warm-connection"
            for rt in ("recruiter", "hiring-manager", "warm-connection", "network"):
                if rt.replace("-", "") in rel.lower().replace("-", "").replace(" ", ""):
                    rel_type = rt
                    break

            if not DRY_RUN:
                company_id = None
                if company:
                    cs = slug(company)
                    cur.execute(
                        "INSERT INTO js_companies (name, slug) VALUES (%s,%s) ON CONFLICT (slug) DO NOTHING",
                        (company, cs)
                    )
                    cur.execute("SELECT id FROM js_companies WHERE slug = %s", (cs,))
                    r = cur.fetchone()
                    company_id = r["id"] if r else None

                cur.execute(
                    """INSERT INTO js_contacts (name, company_id, title, relationship_type, notes)
                       VALUES (%s,%s,%s,%s,%s)
                       ON CONFLICT DO NOTHING""",
                    (name, company_id, title or None, rel_type, notes or None)
                )
            log(f"contact: {name} ({rel_type})")

# ---------------------------------------------------------------------------
# Step 7: js_search_runs from search-log.csv
# ---------------------------------------------------------------------------
def migrate_search_runs(cur):
    print("\n[7] Migrating js_search_runs from search-log.csv …")
    csv_path = APPLICANT_DIR / "search" / "search-log.csv"
    if not csv_path.exists():
        print("  SKIP — file not found")
        return

    with open(csv_path) as f:
        reader = csv.DictReader(f)
        count = 0
        for row in reader:
            profile_slug = row.get("profile", "").strip()
            if not profile_slug:
                continue

            if not DRY_RUN:
                cur.execute("SELECT id FROM js_profiles WHERE slug = %s", (slug(profile_slug),))
                prow = cur.fetchone()
                profile_id = prow["id"] if prow else None

                cur.execute(
                    """INSERT INTO js_search_runs
                       (profile_id, query, pages_fetched, total_results, new_after_dedup, screened, fit_count)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT DO NOTHING""",
                    (profile_id,
                     row.get("query", ""),
                     int(row.get("pages_fetched", 0) or 0),
                     int(row.get("total_results", 0) or 0),
                     int(row.get("new_after_dedup", 0) or 0),
                     int(row.get("screened", 0) or 0),
                     int(row.get("fit_count", 0) or 0))
                )
            count += 1
    log(f"search runs: {count}")

# ---------------------------------------------------------------------------
# Step 8+9: upload all files to object store + record in js_files
# ---------------------------------------------------------------------------
def migrate_files(cur, upload_fn):
    print("\n[8+9] Uploading files to object store + recording in js_files …")

    count = 0
    errors = 0

    def upload_tree(root: Path, key_prefix: str):
        nonlocal count, errors
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            if should_skip(path):
                continue
            rel = path.relative_to(root)
            key = f"{key_prefix}/{rel}" if key_prefix else str(rel)
            key = key.replace("\\", "/")  # Windows safety
            content_type = guess_mime(path)

            try:
                content = path.read_bytes()
                if not DRY_RUN:
                    upload_fn(key, content, content_type)
                    cur.execute(
                        """INSERT INTO js_files (storage_key, bucket, content_type, file_size)
                           VALUES (%s, %s, %s, %s)
                           ON CONFLICT (storage_key) DO UPDATE SET
                             content_type = EXCLUDED.content_type,
                             file_size = EXCLUDED.file_size,
                             updated_at = now()""",
                        (key, os.environ.get("MINIO_BUCKET") or os.environ.get("SUPABASE_BUCKET", "job-search"),
                         content_type, len(content))
                    )
                log(f"{key} ({len(content):,} bytes)")
                count += 1
            except Exception as e:
                print(f"  ERROR uploading {key}: {e}", file=sys.stderr)
                errors += 1

    # APPLICANT_DIR tree (all subdirs)
    upload_tree(APPLICANT_DIR, "")

    # APP_DIR docs → docs/ prefix
    for doc_name in ["README.md", "USER-GUIDE.md", "QUICK-START.md",
                      "DEVELOPER-README.md", "applicant-setup.md", "workflow.md"]:
        doc_path = APP_DIR / doc_name
        if not doc_path.exists():
            continue
        key = f"docs/{doc_name}"
        content = doc_path.read_bytes()
        try:
            if not DRY_RUN:
                upload_fn(key, content, "text/markdown")
                cur.execute(
                    """INSERT INTO js_files (storage_key, bucket, content_type, file_size)
                       VALUES (%s,%s,'text/markdown',%s)
                       ON CONFLICT (storage_key) DO UPDATE SET file_size = EXCLUDED.file_size, updated_at = now()""",
                    (key, os.environ.get("MINIO_BUCKET") or os.environ.get("SUPABASE_BUCKET", "job-search"),
                     len(content))
                )
            log(f"{key} ({len(content):,} bytes)")
            count += 1
        except Exception as e:
            print(f"  ERROR uploading {key}: {e}", file=sys.stderr)

    print(f"  Uploaded: {count} files, {errors} errors")

# ---------------------------------------------------------------------------
# Repair: fix folder_prefix mismatches
# ---------------------------------------------------------------------------
def repair_folder_prefix(cur):
    print("\n[REPAIR] Fixing folder_prefix mismatches against js_files …")

    cur.execute("""
        SELECT DISTINCT regexp_replace(storage_key, '(applications/[^/]+/).*', '\\1') AS folder
        FROM js_files
        WHERE storage_key LIKE 'applications/%'
    """)
    actual_folders = {r["folder"] for r in cur.fetchall()}
    log(f"Found {len(actual_folders)} actual application folders in js_files")

    cur.execute("SELECT id, folder_prefix FROM js_applications WHERE folder_prefix IS NOT NULL")
    repaired, skipped, unmatched = 0, 0, 0
    for row in cur.fetchall():
        fp = row["folder_prefix"]
        if fp in actual_folders:
            skipped += 1
            continue

        inner = fp.removeprefix("applications/").rstrip("/")
        parts = inner.split("-")
        if len(parts) < 4:
            log(f"SKIP: can't parse prefix {fp!r}")
            continue
        search_prefix = f"applications/{parts[0]}-{parts[1]}-{parts[2]}-{parts[3]}"

        matches = [f for f in actual_folders if f.startswith(search_prefix)]
        if len(matches) == 1:
            best = matches[0]
        elif len(matches) > 1:
            # Use token overlap to pick the best match
            computed_tokens = set(inner.split("-"))
            scored = [
                (len(computed_tokens & set(m.removeprefix("applications/").rstrip("/").split("-"))), m)
                for m in matches
            ]
            max_score = max(s for s, _ in scored)
            best_matches = [m for s, m in scored if s == max_score]
            if len(best_matches) == 1:
                best = best_matches[0]
            else:
                log(f"WARNING: ambiguous matches for {fp!r}: {best_matches}")
                unmatched += 1
                continue
        else:
            # Date may differ between tracker applied_date and folder creation date.
            # Fall back to a date-agnostic search using just the company token.
            company_token = parts[3]
            date_agnostic = [f for f in actual_folders if company_token in f]
            if len(date_agnostic) == 0:
                log(f"WARNING: no match for {fp!r} (company token: {company_token!r})")
                unmatched += 1
                continue
            elif len(date_agnostic) == 1:
                best = date_agnostic[0]
            else:
                computed_tokens = set(inner.split("-"))
                scored = [
                    (len(computed_tokens & set(m.removeprefix("applications/").rstrip("/").split("-"))), m)
                    for m in date_agnostic
                ]
                max_score = max(s for s, _ in scored)
                best_matches = [m for s, m in scored if s == max_score]
                if len(best_matches) == 1:
                    best = best_matches[0]
                else:
                    log(f"WARNING: ambiguous date-agnostic matches for {fp!r}: {best_matches}")
                    unmatched += 1
                    continue

        if not DRY_RUN:
            cur.execute("UPDATE js_applications SET folder_prefix = %s WHERE id = %s",
                        (best, row["id"]))
        log(f"repaired: {fp!r} → {best!r}")
        repaired += 1

    print(f"  Repaired: {repaired}, already correct: {skipped}, unresolved: {unmatched}")


# ---------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("OB1 Migration: APPLICANT_DIR → PostgreSQL + Object Store")
    print("=" * 60)
    print(f"APPLICANT_DIR: {APPLICANT_DIR}")
    print(f"DRY_RUN:       {DRY_RUN}")
    print(f"SKIP_FILES:    {SKIP_FILES}")

    conn = None
    try:
        if not DRY_RUN:
            conn = get_db()
            conn.autocommit = False
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        else:
            cur = None  # type: ignore

        if args.repair_folder_prefix:
            if DRY_RUN:
                # For dry-run repair we still need a read-only cursor
                conn = get_db()
                conn.autocommit = True
                cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            repair_folder_prefix(cur)
            if not DRY_RUN and conn:
                conn.commit()
                print("\n✓ Repair committed.")
            else:
                print("\n✓ Dry run complete — no writes made.")
            return

        migrate_applicant(cur)
        migrate_profiles(cur)
        migrate_experience(cur)
        migrate_applications(cur)
        migrate_contacts(cur)
        migrate_search_runs(cur)

        if not SKIP_FILES:
            upload_fn = make_store() if not DRY_RUN else (lambda k, c, t: None)
            migrate_files(cur, upload_fn)

        if not DRY_RUN and conn:
            conn.commit()
            print("\n✓ Migration committed.")
        else:
            print("\n✓ Dry run complete — no writes made.")

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"\n✗ Migration failed: {e}", file=sys.stderr)
        raise
    finally:
        if conn:
            conn.close()

    # Step 10: backfill thought embeddings for all uploaded files
    print("\n[10] Running thought backfill …")
    cmd = [sys.executable, str(Path(__file__).parent / "backfill-thoughts.py")]
    if DRY_RUN:
        cmd.append("--dry-run")
    if SKIP_FILES:
        # Files weren't uploaded so nothing to embed; just wire FK columns
        cmd.append("--only-fk")
    subprocess.run(cmd, check=True)

if __name__ == "__main__":
    main()
