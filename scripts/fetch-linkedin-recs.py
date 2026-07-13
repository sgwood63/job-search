#!/usr/bin/env python3
"""
fetch-linkedin-recs.py — Fetch LinkedIn jobs (recommended feed or keyword search)

Scrapes LinkedIn Jobs using saved session auth.
Auth must be set up first via: python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'

USAGE
    python3 scripts/fetch-linkedin-recs.py                   Fetch recommended feed, output JSON to stdout
    python3 scripts/fetch-linkedin-recs.py --max-pages N     Cap at N pages (default: 4; 0 = unlimited)
    python3 scripts/fetch-linkedin-recs.py --out FILE        Write output to file instead of stdout
    python3 scripts/fetch-linkedin-recs.py --url URL         Scrape a specific LinkedIn search URL instead
    python3 scripts/fetch-linkedin-recs.py --page-delay N    Seconds between pages (default: 20)

EXIT CODES
    0  Success
    1  Error — navigation or extraction failure
    2  Auth required — session expired; re-run:
       python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'

OUTPUT FORMAT (stdout)
    {
      "source": "linkedin-recommended" | "linkedin-search",
      "url": "<base URL used>",
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

def _resolve_auth_dir() -> Path:
    if (v := os.environ.get("AUTH_DIR")):
        return Path(v)
    if (app := os.environ.get("APP_DIR")):
        return Path(app) / ".auth"
    print("[error] AUTH_DIR or APP_DIR not set — source $APP_DIR/.env before running", file=sys.stderr)
    sys.exit(1)

AUTH_FILE = _resolve_auth_dir() / "linkedin.com.json"
BASE_URL = "https://www.linkedin.com/jobs/collections/recommended"
PAGE_SIZE = 25

_AUTH_URL_SIGNALS = ["authwall", "signin", "login", "signup", "join", "challenge", "checkpoint"]
_AUTH_TEXT_SIGNALS = [
    "sign in to linkedin", "join linkedin", "log in to linkedin",
    "please sign in", "please log in",
]

_DEFAULT_CHROME_PROFILE_DARWIN = str(
    Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Default"
)
_DEFAULT_CHROME_PROFILE_LINUX = str(Path.home() / ".config" / "google-chrome" / "Default")


def _default_chrome_profile() -> str:
    import platform
    return _DEFAULT_CHROME_PROFILE_DARWIN if platform.system() == "Darwin" else _DEFAULT_CHROME_PROFILE_LINUX


def _connect_or_launch(p, chrome_profile: str, cdp_port: int):
    """Try CDP connect to existing Chrome; fall back to launching with real profile.

    Returns (ctx, page, is_cdp).
    is_cdp=True  → close only `page` when done (leave browser running).
    is_cdp=False → close `ctx` when done (closes all pages in it).
    """
    try:
        browser = p.chromium.connect_over_cdp(f"http://localhost:{cdp_port}")
        contexts = browser.contexts
        ctx = contexts[0] if contexts else browser.new_context()
        page = ctx.new_page()
        return ctx, page, True
    except Exception:
        pass

    ctx = p.chromium.launch_persistent_context(
        user_data_dir=chrome_profile,
        headless=False,
        channel="chrome",
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
        ],
    )
    page = ctx.new_page()
    return ctx, page, False


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

def _make_job(job_id: str, source: str) -> dict:
    apply_link = f"https://www.linkedin.com/jobs/view/{job_id}/"
    stub = {
        "job_id": job_id, "title": "", "company": "", "location": "",
        "apply_link": apply_link, "posted_at": "",
    }
    return {**stub, "raw": {**stub, "company_name": "", "source": source}}


def _extract_cards(page, source: str) -> list[dict]:
    """Extract job IDs from all visible job cards on the current page.

    Title/company/location are intentionally left empty — LinkedIn's job page
    DOM is unstable. Field data is fetched from each job's individual page
    in the command workflow (fetch-jd.py / WebFetch in Step 5b).
    """
    seen_ids: set[str] = set()
    jobs: list[dict] = []
    matched_sel: str | None = None

    def _urn_to_job_id(urn: str) -> str | None:
        m = re.search(r"jobPosting:(\d+)", urn)
        return m.group(1) if m else None

    # Primary: container elements carrying job ID attributes.
    # Ordered from most stable to least; stops after first selector that yields cards.
    # Each tuple: (css_selector, id_attribute_or_None, urn_attribute_or_None)
    CONTAINER_SELECTORS = (
        ("li[data-occludable-job-id]", "data-occludable-job-id", None),
        ("li.jobs-job-board-list__item", "data-occludable-job-id", None),
        ("div[data-job-id]", "data-job-id", None),
        ("[data-entity-urn*='jobPosting:']", None, "data-entity-urn"),
    )
    for sel, id_attr, urn_attr in CONTAINER_SELECTORS:
        cards = page.query_selector_all(sel)
        if not cards:
            continue
        for card in cards:
            if id_attr:
                job_id = _attr(card, id_attr)
            elif urn_attr:
                job_id = _urn_to_job_id(_attr(card, urn_attr))
            else:
                job_id = None
            if not job_id:
                link = card.query_selector('a[href*="/jobs/view/"]')
                job_id = _job_id_from_url(_attr(link, "href")) if link else None
            if not job_id or job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            jobs.append(_make_job(job_id, source))
        if jobs:
            matched_sel = sel
            break

    # Fallback 1: job-card-container links (more specific than a bare href scan)
    if not jobs:
        for link in page.query_selector_all('a.job-card-container__link[href*="/jobs/view/"]'):
            job_id = _job_id_from_url(_attr(link, "href"))
            if not job_id or job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            jobs.append(_make_job(job_id, source))
        if jobs:
            matched_sel = "a.job-card-container__link"

    # Fallback 2: any job-view link on the page (last resort)
    if not jobs:
        for link in page.query_selector_all('a[href*="/jobs/view/"]'):
            job_id = _job_id_from_url(_attr(link, "href"))
            if not job_id or job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            jobs.append(_make_job(job_id, source))
        if jobs:
            matched_sel = "a[href*='/jobs/view/'] (fallback)"

    # Diagnostics — always report which selector matched and how many cards
    count = len(jobs)
    if jobs:
        sample = [j["job_id"] for j in jobs[:3]]
        print(f"[extract] {count} cards via '{matched_sel}' — sample IDs: {sample}", file=sys.stderr)
    if count < 5:
        print(
            f"[fetch] WARNING: only {count} cards found on this page — "
            "selectors may not match current LinkedIn DOM",
            file=sys.stderr,
        )

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

def fetch_recs(
    max_pages: int | None,
    out: str | None,
    base_url: str,
    page_delay_ms: int,
    use_real_chrome: bool = False,
    chrome_profile: str | None = None,
    cdp_port: int = 9222,
) -> None:
    if not use_real_chrome and not AUTH_FILE.exists():
        print(f"[error] No LinkedIn auth found at {AUTH_FILE}", file=sys.stderr)
        print(
            "Set up auth first: python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'",
            file=sys.stderr,
        )
        sys.exit(2)

    source = "linkedin-search" if "?" in base_url else "linkedin-recommended"
    separator = "&" if "?" in base_url else "?"

    all_jobs: list[dict] = []
    all_seen_ids: set[str] = set()
    pages_fetched = 0
    use_url_pagination = True  # try ?start=N / &start=N first; fall back to clicking Next button

    with sync_playwright() as p:
        if use_real_chrome:
            if not chrome_profile:
                chrome_profile = _default_chrome_profile()
            ctx, page, is_cdp = _connect_or_launch(p, chrome_profile, cdp_port)
            browser = None
        else:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(storage_state=str(AUTH_FILE))
            page = ctx.new_page()
            is_cdp = False

        try:
            start = 0
            navigate_url = base_url  # None means already navigated via button click

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
                        "div[data-job-id], [data-entity-urn*='jobPosting:'], "
                        "a.job-card-container__link, .jobs-search-no-results-banner",
                        timeout=10000,
                    )
                except Exception:
                    print(
                        "[fetch] WARNING: card selector wait timed out — "
                        "proceeding with extraction anyway",
                        file=sys.stderr,
                    )
                page.wait_for_timeout(page_delay_ms)

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
                    if use_real_chrome:
                        print("[auth-expired] LinkedIn session expired in Chrome.", file=sys.stderr)
                        print("Log into LinkedIn in Chrome and retry.", file=sys.stderr)
                    else:
                        print("[auth-expired] LinkedIn session expired.", file=sys.stderr)
                        print(
                            "Re-authenticate: python3 scripts/fetch-jd.py --setup "
                            "'https://www.linkedin.com/login'",
                            file=sys.stderr,
                        )
                    # cleanup happens in finally
                    sys.exit(2)

                cards = _extract_cards(page, source)
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
                            page.wait_for_timeout(page_delay_ms)
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
                    navigate_url = f"{base_url}{separator}start={start}"
                else:
                    btn = _next_button(page)
                    if not btn:
                        print("[fetch] No Next button — end of results.", file=sys.stderr)
                        break
                    btn.click()
                    page.wait_for_timeout(page_delay_ms)
                    navigate_url = None

        finally:
            if is_cdp:
                try:
                    page.close()
                except Exception:
                    pass
            else:
                try:
                    ctx.close()
                except Exception:
                    pass
                if browser is not None:
                    try:
                        browser.close()
                    except Exception:
                        pass

    result = {
        "source": source,
        "url": base_url,
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
        description="Fetch LinkedIn jobs (recommended feed or keyword search) using saved session auth.",
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
    parser.add_argument(
        "--url", type=str, default=BASE_URL, metavar="URL",
        help="Base URL to scrape (default: LinkedIn recommended feed)",
    )
    parser.add_argument(
        "--page-delay", type=int, default=20, metavar="N",
        help="Seconds to wait between pages (default: 20)",
    )
    parser.add_argument(
        "--use-real-chrome", action="store_true", default=False,
        help="Use the user's real Chrome browser instead of headless Chromium (avoids bot detection)",
    )
    parser.add_argument(
        "--chrome-profile", type=str, default=None, metavar="PATH",
        help="Path to Chrome profile dir (overrides CHROME_PROFILE env var)",
    )
    parser.add_argument(
        "--cdp-port", type=int, default=None, metavar="N",
        help="CDP debug port if Chrome is running with --remote-debugging-port=N (overrides LINKEDIN_CDP_PORT env var)",
    )
    args = parser.parse_args()
    # 0 means unlimited — convert to None for the internal API
    max_pages = None if args.max_pages == 0 else args.max_pages
    chrome_profile = args.chrome_profile or os.environ.get("CHROME_PROFILE")
    cdp_port = args.cdp_port if args.cdp_port is not None else int(os.environ.get("LINKEDIN_CDP_PORT", "9222"))
    fetch_recs(
        max_pages=max_pages,
        out=args.out,
        base_url=args.url,
        page_delay_ms=args.page_delay * 1000,
        use_real_chrome=args.use_real_chrome,
        chrome_profile=chrome_profile,
        cdp_port=cdp_port,
    )
