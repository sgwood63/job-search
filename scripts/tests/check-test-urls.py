#!/usr/bin/env python3
"""
check-test-urls.py — Maintenance script to detect stale entries in public-jd-urls.json.

Runs fetch-jd.py against every non-stable URL and reports status.
For expired URLs (exit 3), prints a search_chunks_semantic query to find a replacement.

Usage:
    python3 scripts/tests/check-test-urls.py

Environment:
    PLAYWRIGHT_PYTHON  Python interpreter with Playwright installed.
                       Defaults to sys.executable. Same convention as conftest.py.
    APP_DIR or AUTH_DIR must be set (source $APP_DIR/.env before running).

Exit codes:
    0  All non-stable URLs returned exit 0 or exit 3 (actionable — closed posting).
    1  At least one URL returned exit 1 or 2 (unexpected error — needs investigation).
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

_SCRIPTS_DIR = Path(__file__).parent.parent
_DATA_FILE = Path(__file__).parent / "data" / "public-jd-urls.json"
_FETCH_JD = _SCRIPTS_DIR / "fetch-jd.py"


def playwright_python() -> str:
    return os.environ.get("PLAYWRIGHT_PYTHON", sys.executable)


def _semantic_query(entry: dict) -> str:
    domain = urlparse(entry["url"]).netloc.removeprefix("www.")
    ob1_source = entry.get("ob1_source", "").rstrip("/")
    if ob1_source:
        return f"Source: https {domain} fetched via fetch-jd — {ob1_source}"
    return f"Source: https {domain} fetched via fetch-jd"


def main() -> int:
    if not _DATA_FILE.exists():
        print(f"ERROR: Data file not found: {_DATA_FILE}", file=sys.stderr)
        return 1

    data = json.loads(_DATA_FILE.read_text())
    non_stable = [e for e in data.get("urls", []) if not e.get("stable", False)]

    if not non_stable:
        print("No non-stable entries in public-jd-urls.json — nothing to check.")
        return 0

    print(f"Checking {len(non_stable)} non-stable URL(s)...\n")

    results = []
    for entry in non_stable:
        print(f"  [{entry['label']}]")
        print(f"  {entry['url']}")
        try:
            proc = subprocess.run(
                [playwright_python(), str(_FETCH_JD), entry["url"]],
                capture_output=True, text=True, timeout=60, env=os.environ.copy(),
            )
            rc, stderr = proc.returncode, proc.stderr.strip()
        except subprocess.TimeoutExpired:
            print(f"  ERROR  timeout after 60s\n")
            results.append({"entry": entry, "rc": -1})
            continue

        results.append({"entry": entry, "rc": rc, "stderr": stderr})
        if rc == 0:
            print(f"  OK  (exit 0)\n")
        elif rc == 3:
            print(f"  SKIP/closed  (exit 3 — posting expired)")
            print(f"  Replacement query (run in a Claude Code session):")
            print(f"    mcp__job-search__search_chunks_semantic('{_semantic_query(entry)}')\n")
        else:
            print(f"  ERROR  (exit {rc})")
            print(f"  stderr: {stderr[:200] or '(none)'}\n")

    ok = sum(1 for r in results if r["rc"] == 0)
    closed = sum(1 for r in results if r["rc"] == 3)
    errors = [r for r in results if r["rc"] not in (0, 3)]

    print("-" * 60)
    print(f"Results: {ok} OK, {closed} closed, {len(errors)} unexpected error(s)")
    if errors:
        print("Unexpected errors (investigate):")
        for r in errors:
            e = r["entry"]
            note = "timeout" if r["rc"] == -1 else f"exit {r['rc']}"
            print(f"  - {e['label']}: {note}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
