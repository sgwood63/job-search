#!/usr/bin/env python3
"""
search-jobs.py — Search Google Jobs via SearchAPI for a given profile.

USAGE
    python3 scripts/search-jobs.py <profile-name>
    python3 scripts/search-jobs.py <profile-name> --page-token <token>
    python3 scripts/search-jobs.py <profile-name> --dry-run

    Reads the OR-query for <profile-name> from $APPLICANT_DIR/profiles/PROFILES-QUICK-REFERENCE.md
    Deduplicates against $APPLICANT_DIR/profiles/<profile-name>/search-results/seen-jobs.json
    Saves raw API response to $APPLICANT_DIR/profiles/<profile-name>/search-results/
    Prints JSON result to stdout; errors to stderr

OUTPUT (stdout)
    {
      "profile": "presales-se",
      "query": "...",
      "new_jobs": [...],
      "next_page_token": "...",   // null if no more pages
      "total_fetched": 10,
      "total_new": 7,
      "api_calls_made": 1
    }

ENV VARS
    APP_DIR          — job search process repo directory
    APPLICANT_DIR    — applicant data directory
    SEARCHAPI_KEY    — SearchAPI authentication key
    SEARCH_BATCH_SIZE — max new jobs to return per call (default: 10)

EXIT CODES
    0  Success
    1  Error (missing env var, profile not found, API error)
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path


def load_env():
    """Source $APP_DIR/.env if env vars not already set."""
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    # Handle `export KEY="VALUE"` and `KEY=VALUE`
                    line = line.removeprefix("export ")
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key not in os.environ:
                        os.environ[key] = val


def get_env(key, default=None):
    val = os.environ.get(key, default)
    if val is None:
        print(f"Error: {key} is not set. Check $APP_DIR/.env", file=sys.stderr)
        sys.exit(1)
    return val


def parse_query_for_profile(quick_ref_path: Path, profile: str) -> str:
    """Extract the OR-query for a profile from the ## Search Queries table."""
    content = quick_ref_path.read_text()
    # Find the ## Search Queries section
    section_match = re.search(r"## Search Queries\s*\n", content)
    if not section_match:
        print(f"Error: '## Search Queries' section not found in {quick_ref_path}", file=sys.stderr)
        sys.exit(1)

    section_text = content[section_match.end():]
    # Find the table row matching this profile slug
    # Row format: | profile-slug | `query string` |
    row_pattern = re.compile(
        r"^\|\s*" + re.escape(profile) + r"\s*\|\s*`([^`]+)`\s*\|",
        re.MULTILINE,
    )
    row_match = row_pattern.search(section_text)
    if not row_match:
        print(
            f"Error: no search query found for profile '{profile}' in {quick_ref_path}",
            file=sys.stderr,
        )
        sys.exit(1)

    return row_match.group(1).strip()


def load_seen_jobs(seen_path: Path) -> set:
    if not seen_path.exists():
        return set()
    data = json.loads(seen_path.read_text())
    return set(data.get("job_ids", []))


def save_seen_jobs(seen_path: Path, seen: set):
    seen_path.write_text(json.dumps({"job_ids": sorted(seen)}, indent=2))


def call_searchapi(query: str, api_key: str, page_token: str | None) -> dict:
    params = {
        "engine": "google_jobs",
        "q": query,
        "location": "United States",
        "gl": "us",
        "hl": "en",
        "api_key": api_key,
    }
    if page_token:
        params["next_page_token"] = page_token

    url = "https://www.searchapi.io/api/v1/search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "job-search-agent/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"Error: SearchAPI returned {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: SearchAPI request failed: {e}", file=sys.stderr)
        sys.exit(1)


def extract_job_id(job: dict) -> str:
    """Extract a stable job ID: prefer job_id/id, fall back to htidocid in sharing_link."""
    jid = job.get("job_id") or job.get("id") or ""
    if not jid:
        sharing_link = job.get("sharing_link", "")
        match = re.search(r"htidocid=([^&#]+)", sharing_link)
        if match:
            jid = urllib.parse.unquote(match.group(1))
    return jid


def normalize_job(job: dict) -> dict:
    """Extract consistent fields from a SearchAPI job object."""
    apply_options = job.get("apply_options") or job.get("apply_links") or [{}]
    return {
        "job_id": extract_job_id(job),
        "title": job.get("title", ""),
        "company": job.get("company_name", "") or job.get("company", ""),
        "location": job.get("location", ""),
        "description": job.get("description", ""),
        "apply_link": job.get("apply_link") or apply_options[0].get("link", ""),
        "posted_at": job.get("detected_extensions", {}).get("posted_at", ""),
        "raw": job,
    }


def main():
    load_env()
    parser = argparse.ArgumentParser(description="Search Google Jobs via SearchAPI")
    parser.add_argument("profile", help="Profile slug (e.g. presales-se)")
    parser.add_argument("--page-token", default=None, help="Pagination token from previous call")
    parser.add_argument("--query", default=None, help="Override search query (skips table lookup)")
    parser.add_argument("--dry-run", action="store_true", help="Print params, skip API call")
    args = parser.parse_args()

    applicant_dir = Path(get_env("APPLICANT_DIR"))
    api_key = get_env("SEARCHAPI_KEY")
    batch_size = int(os.environ.get("SEARCH_BATCH_SIZE", "10"))

    profiles_dir = applicant_dir / "profiles"
    quick_ref = profiles_dir / "PROFILES-QUICK-REFERENCE.md"
    profile_dir = profiles_dir / args.profile
    search_results_dir = profile_dir / "search-results"

    if not quick_ref.exists():
        print(f"Error: {quick_ref} not found", file=sys.stderr)
        sys.exit(1)
    if not profile_dir.exists():
        print(f"Error: profile directory {profile_dir} not found", file=sys.stderr)
        sys.exit(1)

    search_results_dir.mkdir(parents=True, exist_ok=True)

    query = args.query if args.query else parse_query_for_profile(quick_ref, args.profile)
    seen = load_seen_jobs(search_results_dir / "seen-jobs.json")

    if args.dry_run:
        print(json.dumps({
            "dry_run": True,
            "profile": args.profile,
            "query": query,
            "query_source": "flag" if args.query else "table",
            "page_token": args.page_token,
            "params": {
                "engine": "google_jobs",
                "q": query,
                "location": "United States",
                "gl": "us",
                "hl": "en",
                "next_page_token": args.page_token,
            },
            "seen_jobs_count": len(seen),
        }, indent=2))
        return

    response = call_searchapi(query, api_key, args.page_token)

    # Save raw response
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    raw_file = search_results_dir / f"{timestamp}_page.json"
    raw_file.write_text(json.dumps(response, indent=2))

    raw_jobs = response.get("jobs", [])
    total_fetched = len(raw_jobs)
    next_page_token = response.get("pagination", {}).get("next_page_token")

    # Deduplicate: update seen with ALL fetched job IDs
    new_jobs = []
    for job in raw_jobs:
        normalized = normalize_job(job)
        jid = normalized["job_id"]
        if jid and jid not in seen:
            new_jobs.append(normalized)
        if jid:
            seen.add(jid)

    save_seen_jobs(search_results_dir / "seen-jobs.json", seen)

    # Respect batch_size — caller can paginate for more
    new_jobs = new_jobs[:batch_size]

    result = {
        "profile": args.profile,
        "query": query,
        "new_jobs": new_jobs,
        "next_page_token": next_page_token,
        "total_fetched": total_fetched,
        "total_new": len(new_jobs),
        "api_calls_made": 1,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
