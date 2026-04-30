#!/usr/bin/env python3
"""
fetch-jd.py — Authenticated web page fetcher for job search workflow

Fetches job description pages that require login. Auth state is saved per
domain so subsequent fetches are headless (no browser window needed).

USAGE
    python3 scripts/fetch-jd.py <url>             Fetch URL (headless, requires auth)
    python3 scripts/fetch-jd.py --setup <url>     Interactive login + save auth for domain
    python3 scripts/fetch-jd.py --clear <domain>  Clear saved auth for a domain
    python3 scripts/fetch-jd.py --list            List domains with saved auth

AUTH FLOW
    First time for a site:
        python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/jobs/view/123'
        → opens a browser window → you log in → press Enter → auth saved
    Subsequent fetches (called automatically by Claude):
        python3 scripts/fetch-jd.py 'https://www.linkedin.com/jobs/view/123'
        → headless, uses saved auth → prints page text to stdout

EXIT CODES
    0  Success — page text printed to stdout
    1  Error — navigation or script failure
    2  Auth required — no saved auth (or expired); run --setup <url> first

AUTH STORAGE
    .auth/<domain>.json (gitignored, per-user, never committed)
"""

import sys
import json
from pathlib import Path
from urllib.parse import urlparse

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print(
        "[error] playwright not found. Install it:\n"
        "  pip install playwright && playwright install chromium\n"
        "Or use the Anaconda python that has it:\n"
        "  /opt/homebrew/anaconda3/bin/python3 scripts/fetch-jd.py ...",
        file=sys.stderr,
    )
    sys.exit(1)

REPO_DIR = Path(__file__).parent.parent
AUTH_DIR = REPO_DIR / ".auth"

# URL fragments that indicate an auth wall
AUTH_URL_SIGNALS = ["authwall", "signin", "login", "signup", "join", "challenge", "session"]
# Text patterns that indicate an auth wall (checked in first 800 chars of body)
AUTH_TEXT_SIGNALS = [
    "sign in to linkedin", "join linkedin", "log in to linkedin",
    "please sign in", "please log in", "create an account to",
    "sign in to view", "join to see",
]


def get_domain(url: str) -> str:
    host = urlparse(url).netloc
    # Strip www. prefix for cleaner filenames
    return host.removeprefix("www.")


def auth_file(domain: str) -> Path:
    AUTH_DIR.mkdir(exist_ok=True)
    return AUTH_DIR / f"{domain}.json"


def is_auth_wall(url: str, title: str, body: str) -> bool:
    url_l = url.lower()
    title_l = title.lower()
    body_l = body[:800].lower()
    return (
        any(s in url_l for s in AUTH_URL_SIGNALS)
        or any(s in title_l for s in ["sign in", "log in", "join now"])
        or any(s in body_l for s in AUTH_TEXT_SIGNALS)
    )


def fetch(url: str, html_out: str | None = None) -> None:
    """Fetch a URL headlessly using saved auth. Exits with code 2 if auth needed."""
    domain = get_domain(url)
    saved = auth_file(domain)

    if not saved.exists():
        print(f"[auth-required] No saved auth for {domain}.", file=sys.stderr)
        print(f"Run this in your terminal to authenticate:", file=sys.stderr)
        print(f"  python3 scripts/fetch-jd.py --setup '{url}'", file=sys.stderr)
        sys.exit(2)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(storage_state=str(saved))
        page = ctx.new_page()

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2000)  # Let JS render
        except Exception as e:
            print(f"[error] Navigation failed: {e}", file=sys.stderr)
            ctx.close()
            browser.close()
            sys.exit(1)

        # Expand any collapsed content sections ("Show more", "See more", etc.)
        expand_selectors = [
            "button:has-text('Show more')",
            "button:has-text('See more')",
            "button:has-text('Show full description')",
            "button:has-text('Show all')",
            "[aria-label*='show more' i]",
            ".show-more-less-html__button",
            ".jobs-description__footer-button",
        ]
        for sel in expand_selectors:
            try:
                btns = page.locator(sel).all()
                for btn in btns:
                    if btn.is_visible():
                        btn.click()
                        page.wait_for_timeout(500)
            except Exception:
                pass
        page.wait_for_timeout(500)  # Settle after all expansions

        title = page.title()
        final_url = page.url

        if html_out:
            Path(html_out).write_text(page.content(), encoding="utf-8")

        body = page.inner_text("body") or ""
        ctx.close()
        browser.close()

    if is_auth_wall(final_url, title, body):
        print(f"[auth-expired] Auth for {domain} has expired.", file=sys.stderr)
        print(f"Re-authenticate by running:", file=sys.stderr)
        print(f"  python3 scripts/fetch-jd.py --setup '{url}'", file=sys.stderr)
        sys.exit(2)

    # Output: structured header then full body text
    print(f"URL: {final_url}")
    print(f"Title: {title}")
    print()
    print(body)


def setup(url: str) -> None:
    """Interactive: open browser, let user log in, save auth state."""
    domain = get_domain(url)
    print(f"[setup] Opening browser for {domain}...", file=sys.stderr)
    print(f"[setup] 1. Log in to the site in the browser window.", file=sys.stderr)
    print(f"[setup] 2. Navigate to the target page so you can see it.", file=sys.stderr)
    print(f"[setup] 3. Come back here and press Enter.", file=sys.stderr)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(url)

        input("\n[setup] Press Enter when logged in and the page is visible... ")

        state = ctx.storage_state()
        browser.close()

    out = auth_file(domain)
    out.write_text(json.dumps(state, indent=2))
    print(f"\n[setup] Auth saved to {out}", file=sys.stderr)
    print(f"[setup] Claude can now fetch {domain} pages headlessly.", file=sys.stderr)


def clear(domain: str) -> None:
    f = auth_file(domain)
    if f.exists():
        f.unlink()
        print(f"[clear] Removed auth for {domain}")
    else:
        print(f"[clear] No saved auth found for {domain}")


def list_auth() -> None:
    if not AUTH_DIR.exists():
        print("No .auth/ directory found.")
        return
    files = sorted(AUTH_DIR.glob("*.json"))
    if not files:
        print("No saved auth states.")
        return
    print("Saved auth domains:")
    for f in files:
        print(f"  {f.stem}")


if __name__ == "__main__":
    args = sys.argv[1:]

    if not args:
        print(__doc__)
        sys.exit(1)

    if args[0] == "--setup":
        if len(args) < 2:
            print("Usage: python3 scripts/fetch-jd.py --setup <url>", file=sys.stderr)
            sys.exit(1)
        setup(args[1])

    elif args[0] == "--clear":
        if len(args) < 2:
            print("Usage: python3 scripts/fetch-jd.py --clear <domain>", file=sys.stderr)
            sys.exit(1)
        clear(args[1])

    elif args[0] == "--list":
        list_auth()

    elif args[0] == "--html-out":
        if len(args) < 3:
            print("Usage: python3 scripts/fetch-jd.py --html-out <filepath> <url>", file=sys.stderr)
            sys.exit(1)
        fetch(args[2], html_out=args[1])

    else:
        fetch(args[0])
