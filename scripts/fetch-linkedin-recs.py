#!/usr/bin/env python3
"""
fetch-linkedin-recs.py — Fetch LinkedIn job recommendations

Scrapes the LinkedIn Jobs recommended feed using saved session auth.
Auth must be set up first via: python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'

USAGE
    python3 scripts/fetch-linkedin-recs.py              Fetch all pages, output JSON to stdout
    python3 scripts/fetch-linkedin-recs.py --max-pages N   Cap at N pages
    python3 scripts/fetch-linkedin-recs.py --out FILE      Write output to file instead of stdout

EXIT CODES
    0  Success
    1  Error — navigation or extraction failure
    2  Auth required — session expired; re-run:
       python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'

OUTPUT FORMAT (stdout)
    {
      "source": "linkedin-recommended",
      "url": "https://www.linkedin.com/jobs/collections/recommended",
      "fetched_at": "YYYY-MM-DDThh:mm:ss",
      "pages_fetched": N,
      "total": N,
      "jobs": [
        {
          "job_id": "...",
          "title": "...",
          "company": "...",
          "location": "...",
          "apply_link": "https://www.linkedin.com/jobs/view/{id}/",
          "posted_at": "...",
          "raw": { ... }
        }
      ]
    }

AUTH STORAGE
    $APPLICANT_DIR/.auth/linkedin.com.json  (Playwright storage state format)
    Requires APPLICANT_DIR env var — source $APP_DIR/.env before running.
"""

import os
import sys
import json
import re
import argparse
from datetime import datetime, timezone
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print(
        "[error] playwright not found. Install it:\n"
        "  pip install playwright && playwright install chromium\n"
        "Or use the Anaconda python that has it:\n"
        "  /opt/homebrew/anaconda3/bin/python3 scripts/fetch-linkedin-recs.py ...",
        file=sys.stderr,
    )
    sys.exit(1)

_applicant_dir = os.environ.get("APPLICANT_DIR")
if not _applicant_dir:
    print("[error] APPLICANT_DIR not set — source $APP_DIR/.env before running", file=sys.stderr)
    sys.exit(1)

AUTH_FILE = Path(_applicant_dir) / ".auth" / "linkedin.com.json"
BASE_URL = "https://www.linkedin.com/jobs/collections/recommended"
PAGE_SIZE = 25

_AUTH_URL_SIGNALS = ["authwall", "signin", "login", "signup", "join", "challenge", "checkpoint"]
_AUTH_TEXT_SIGNALS = [
    "sign in to linkedin", "join linkedin", "log in to linkedin",
    "please sign in", "please log in",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_auth_wall(url: str, title: str, body_sample: str) -> bool:
    url_l = url.lower()
    title_l = title.lower()
    body_l = body_sample.lower()
    return (
        any(s in url_l for s in _AUTH_URL_SIGNALS)
        or any(s in title_l for s in ["sign in", "log in", "join now"])
        or any(s in body_l for s in _AUTH_TEXT_SIGNALS)
    )


def _job_id_from_url(url: str) -> str | None:
    m = re.search(r"/jobs/view/(\d+)", url)
    return m.group(1) if m else None


def _text(el) -> str:
    if el is None:
        return ""
    try:
        return (el.inner_text() or "").strip()
    except Exception:
        return ""


def _attr(el, name: str) -> str:
    if el is None:
        return ""
    try:
        return (el.get_attribute(name) or "").strip()
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Card extraction
# ---------------------------------------------------------------------------

def _make_job(job_id: str) -> dict:
    apply_link = f"https://www.linkedin.com/jobs/view/{job_id}/"
    stub = {
        "job_id": job_id, "title": "", "company": "", "location": "",
        "apply_link": apply_link, "posted_at": "",
    }
    return {**stub, "raw": {**stub, "company_name": "", "source": "linkedin-recommended"}}


def _extract_cards(page) -> list[dict]:
    """Extract job IDs from all visible job cards on the current page.

    Title/company/location are intentionally left empty — LinkedIn's recommendation
    page DOM is unstable. Field data is fetched from each job's individual page
    in the command workflow (fetch-jd.py / WebFetch in Step 5b).
    """
    seen_ids: set[str] = set()
    jobs: list[dict] = []

    # Primary: card list items carry data-occludable-job-id (stable across DOM changes)
    for sel in ("li[data-occludable-job-id]", "li.jobs-job-board-list__item"):
        cards = page.query_selector_all(sel)
        if not cards:
            continue
        for card in cards:
            job_id = _attr(card, "data-occludable-job-id") or _attr(card, "data-job-id")
            if not job_id:
                link = card.query_selector('a[href*="/jobs/view/"]')
                job_id = _job_id_from_url(_attr(link, "href")) if link else None
            if not job_id or job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            jobs.append(_make_job(job_id))
        break  # stop after first selector that yields cards

    # Fallback: harvest IDs from any job-view links on the page
    if not jobs:
        for link in page.query_selector_all('a[href*="/jobs/view/"]'):
            job_id = _job_id_from_url(_attr(link, "href"))
            if not job_id or job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            jobs.append(_make_job(job_id))

    return jobs


def _next_button(page):
    """Return the enabled next-page button element, or None."""
    for sel in (
        "button[aria-label='Next']",
        "button[aria-label='next']",
        "button.artdeco-pagination__button--next",
        "li.artdeco-pagination__indicator--number + li button",
    ):
        try:
            btn = page.query_selector(sel)
            if btn and btn.is_visible() and not btn.is_disabled():
                return btn
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# Main fetch
# ---------------------------------------------------------------------------

def fetch_recs(max_pages: int | None, out: str | None) -> None:
    if not AUTH_FILE.exists():
        print(f"[error] No LinkedIn auth found at {AUTH_FILE}", file=sys.stderr)
        print(
            "Set up auth first: python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'",
            file=sys.stderr,
        )
        sys.exit(2)

    all_jobs: list[dict] = []
    all_seen_ids: set[str] = set()
    pages_fetched = 0
    use_url_pagination = True  # try ?start=N first; fall back to clicking Next button

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(storage_state=str(AUTH_FILE))
        page = ctx.new_page()

        try:
            start = 0
            navigate_url = BASE_URL  # None means already navigated via button click

            while True:
                if max_pages is not None and pages_fetched >= max_pages:
                    break

                # Navigate if we have a target URL
                if navigate_url:
                    print(f"[fetch] Page {pages_fetched + 1}: {navigate_url}", file=sys.stderr)
                    try:
                        page.goto(navigate_url, wait_until="domcontentloaded", timeout=30000)
                    except Exception as exc:
                        print(f"[error] Navigation failed: {exc}", file=sys.stderr)
                        break

                # Wait for SPA to render job cards
                try:
                    page.wait_for_selector(
                        "li[data-occludable-job-id], li.jobs-job-board-list__item, "
                        ".jobs-search-no-results-banner",
                        timeout=10000,
                    )
                except Exception:
                    pass
                page.wait_for_timeout(1500)

                # Auth wall check
                title = page.title()
                final_url = page.url
                body_sample = ""
                try:
                    body_el = page.query_selector("body")
                    body_sample = _text(body_el)[:800] if body_el else ""
                except Exception:
                    pass

                if _is_auth_wall(final_url, title, body_sample):
                    print("[auth-expired] LinkedIn session expired.", file=sys.stderr)
                    print(
                        "Re-authenticate: python3 scripts/fetch-jd.py --setup "
                        "'https://www.linkedin.com/login'",
                        file=sys.stderr,
                    )
                    ctx.close()
                    browser.close()
                    sys.exit(2)

                cards = _extract_cards(page)
                new_cards = [c for c in cards if c["job_id"] not in all_seen_ids]

                if not new_cards:
                    if use_url_pagination and start > 0:
                        # URL params yielded duplicate results — fall back to Next button
                        print(
                            "[fetch] URL pagination exhausted — trying Next button...",
                            file=sys.stderr,
                        )
                        use_url_pagination = False
                        btn = _next_button(page)
                        if btn:
                            btn.click()
                            page.wait_for_timeout(2000)
                            navigate_url = None
                            continue
                    print("[fetch] No new jobs — end of results.", file=sys.stderr)
                    break

                for card in new_cards:
                    all_seen_ids.add(card["job_id"])
                    all_jobs.append(card)

                pages_fetched += 1
                print(
                    f"[fetch] Page {pages_fetched}: +{len(new_cards)} new "
                    f"(total: {len(all_jobs)})",
                    file=sys.stderr,
                )

                if len(cards) < PAGE_SIZE:
                    print(
                        f"[fetch] Partial page ({len(cards)} cards) — continuing.",
                        file=sys.stderr,
                    )

                # Advance to next page
                if use_url_pagination:
                    start += PAGE_SIZE
                    navigate_url = f"{BASE_URL}?start={start}"
                else:
                    btn = _next_button(page)
                    if not btn:
                        print("[fetch] No Next button — end of results.", file=sys.stderr)
                        break
                    btn.click()
                    page.wait_for_timeout(2000)
                    navigate_url = None

        finally:
            ctx.close()
            browser.close()

    result = {
        "source": "linkedin-recommended",
        "url": BASE_URL,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        "pages_fetched": pages_fetched,
        "total": len(all_jobs),
        "jobs": all_jobs,
    }
    output = json.dumps(result, indent=2, ensure_ascii=False)

    if out:
        Path(out).write_text(output, encoding="utf-8")
        print(
            f"[done] {len(all_jobs)} jobs across {pages_fetched} page(s) → {out}",
            file=sys.stderr,
        )
    else:
        print(output)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch LinkedIn job recommendations using saved session auth.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--max-pages", type=int, default=4, metavar="N",
        help="Maximum number of pages to fetch (default: 4; pass 0 for unlimited)",
    )
    parser.add_argument(
        "--out", type=str, default=None, metavar="FILE",
        help="Write JSON output to FILE instead of stdout",
    )
    args = parser.parse_args()
    # 0 means unlimited — convert to None for the internal API
    max_pages = None if args.max_pages == 0 else args.max_pages
    fetch_recs(max_pages=max_pages, out=args.out)
