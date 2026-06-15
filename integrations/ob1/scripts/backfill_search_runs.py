#!/usr/bin/env python3
"""
backfill_search_runs.py — Python port of backfill_search_runs.ts

Populates js_search_runs and js_ingested_positions from OB1 summary .md files.
Uses only the OB1 REST API (no direct DB access). Safe to re-run (idempotent).

Usage:
    OB1_BASE_URL=http://localhost:8001 \
    OB1_API_KEY=your-key \
    python3 integrations/ob1/scripts/backfill_search_runs.py
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("OB1_BASE_URL", "http://localhost:8001").rstrip("/")
API_KEY  = os.environ.get("OB1_API_KEY", "")

if not API_KEY:
    print("OB1_API_KEY is required", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "x-brain-key": API_KEY,
    "Content-Type": "application/json",
}

# ---------------------------------------------------------------------------
# REST helpers
# ---------------------------------------------------------------------------

def _request(method: str, path: str, body: dict | None = None) -> bytes:
    url = BASE_URL + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return b"409"
        raise RuntimeError(f"{method} {path} → {e.code}: {e.read().decode()}") from e


def list_files(prefix: str) -> list[dict]:
    path = f"/api/v2/files?prefix={urllib.parse.quote(prefix)}"
    return json.loads(_request("GET", path))


def read_file(key: str) -> str:
    path = f"/api/v2/files/{urllib.parse.quote(key, safe='')}"
    return _request("GET", path).decode()


def get_existing_summary_keys() -> set[str]:
    raw = json.loads(_request("GET", "/api/v2/search-runs?limit=500"))
    return {r["summary_key"] for r in raw if r.get("summary_key")}


def post_search_run(args: dict) -> str:
    data = json.loads(_request("POST", "/api/v2/search-runs", args))
    return data["id"]


def post_ingested_position(args: dict) -> None:
    result = _request("POST", "/api/v2/ingested-positions", args)
    if result == b"409":
        return  # duplicate — skip silently


# ---------------------------------------------------------------------------
# Summary .md parser
# ---------------------------------------------------------------------------

def parse_field(lines: list[str], label: str) -> str:
    bold_prefix = f"**{label}:**"
    # Match "Label: value" or "Label (anything): value" for older plain-text summaries
    plain_re = re.compile(rf'^{re.escape(label)}[^:]*:', re.IGNORECASE)
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(bold_prefix):
            return stripped[len(bold_prefix):].strip()
        if plain_re.match(stripped):
            return stripped[stripped.index(':') + 1:].strip()
    return ""


def parse_int(text: str) -> int:
    """Extract first integer, tolerating ~ prefixes and trailing annotations."""
    m = re.match(r'~?\s*(\d+)', text.strip())
    return int(m.group(1)) if m else 0


def parse_run_at(date_str: str) -> str:
    return date_str.replace(" ", "T")


def parse_table(content: str, section_header: str) -> list[list[str]]:
    idx = content.find(f"## {section_header}")
    if idx == -1:
        return []
    section = content[idx:]
    rows = []
    in_table = False
    for line in section.split("\n"):
        if line.startswith("|") and not re.match(r"^\|\s*[-:]+\s*\|", line):
            if not in_table:
                in_table = True
                continue  # skip header row
            cells = [c.strip() for c in line.split("|")[1:-1]]
            if cells:
                rows.append(cells)
        elif in_table and not line.startswith("|") and line.strip():
            break
    return rows


def parse_summary_md(content: str, file_key: str) -> dict | None:
    lines = content.split("\n")

    # Profile from filename: search/YYYY-MM-DD-HHMMSS-<profile>-summary.md
    m = re.search(r"search/\d{4}-\d{2}-\d{2}-\d{6}-(.+)-summary\.md$", file_key)
    if m:
        profile_slug = m.group(1)
    else:
        profile_slug = parse_field(lines, "Profile") or None

    date_str = parse_field(lines, "Date")
    if not date_str:
        return None

    pages_fetched   = parse_int(parse_field(lines, "Pages fetched"))
    total_results   = parse_int(parse_field(lines, "Total results"))
    new_after_dedup = parse_int(parse_field(lines, "New (deduped)"))
    screened        = parse_int(parse_field(lines, "Screened"))
    fit_count       = parse_int(parse_field(lines, "Fit"))

    # Build query from Sub-queries section
    query = profile_slug
    sub_idx = content.find("## Sub-queries")
    if sub_idx != -1:
        sub_section = content[sub_idx + len("## Sub-queries"):]
        query_lines = []
        for l in sub_section.split("\n")[1:]:
            if l.startswith("##"):
                break
            cleaned = re.sub(r"^\d+\.\s*", "", l).strip()
            if cleaned:
                query_lines.append(cleaned)
        if query_lines:
            query = " | ".join(query_lines)

    positions = []

    for row in parse_table(content, "Fit Jobs (score >= 7)"):
        if row and row[0] and row[0] != "_No fit jobs found._":
            positions.append({"company": row[0], "role": row[1] if len(row) > 1 else "", "outcome": "fit"})

    for row in parse_table(content, "No-Fit Jobs"):
        if row and row[0] and row[0] != "_No no-fit jobs._":
            reason = row[4] if len(row) > 4 else (row[3] if len(row) > 3 else "")
            positions.append({"company": row[0], "role": row[1] if len(row) > 1 else "", "outcome": "no-fit", "reason": reason})

    for row in parse_table(content, "Failed to Fetch"):
        if row and row[0] and row[0] != "_No fetch failures._":
            reason = row[3] if len(row) > 3 else (row[2] if len(row) > 2 else "")
            positions.append({"company": row[0], "role": row[1] if len(row) > 1 else "", "outcome": "fetch-failed", "reason": reason})

    return {
        "header": {
            "profile_slug": profile_slug,
            "query": query,
            "run_at": parse_run_at(date_str),
            "pages_fetched": pages_fetched,
            "total_results": total_results,
            "new_after_dedup": new_after_dedup,
            "screened": screened,
            "fit_count": fit_count,
        },
        "positions": positions,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Connecting to OB1 at {BASE_URL} …")

    all_files = list_files("search/")
    summary_files = sorted(
        [f for f in all_files if f["key"].endswith("-summary.md")],
        key=lambda f: f["key"],
    )
    print(f"Found {len(summary_files)} summary file(s) to process.\n")

    existing_keys = get_existing_summary_keys()

    created = skipped = total_positions = errors = 0

    for file in summary_files:
        try:
            content = read_file(file["key"])
            parsed = parse_summary_md(content, file["key"])

            if not parsed:
                print(f"  [SKIP] {file['key']} — could not parse header")
                skipped += 1
                continue

            header = parsed["header"]
            pos_rows = parsed["positions"]

            if file["key"] in existing_keys:
                print(f"  [SKIP] {file['key']} — run already exists")
                skipped += 1
                continue

            run_id = post_search_run({
                "profile_slug": header["profile_slug"],
                "query": header["query"],
                "pages_fetched": header["pages_fetched"],
                "total_results": header["total_results"],
                "new_after_dedup": header["new_after_dedup"],
                "screened": header["screened"],
                "fit_count": header["fit_count"],
                "summary_key": file["key"],
            })
            created += 1

            for pos in pos_rows:
                post_ingested_position({
                    "company_name": pos["company"],
                    "role_title": pos["role"],
                    "profile_slug": header["profile_slug"],
                    "search_run_id": run_id,
                    "outcome": pos["outcome"],
                    "no_fit_reason": pos.get("reason") or None,
                })
                total_positions += 1

            print(f"  [OK]   {file['key']} — run {run_id[:8]} — {len(pos_rows)} positions")

        except Exception as e:
            print(f"  [ERROR] {file['key']}: {e}", file=sys.stderr)
            errors += 1

    print(f"\nDone: {created} runs created, {skipped} skipped, {total_positions} positions inserted, {errors} errors")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
