#!/usr/bin/env python3
"""
fetch-jd.py — Authenticated web page fetcher for job search workflow

Fetches job description pages that require login. Auth state is saved per
domain so subsequent fetches are headless (no browser window needed).

USAGE
    python3 scripts/fetch-jd.py <url>                  Fetch URL, print text to stdout
    python3 scripts/fetch-jd.py --md-out <file> <url>  Save full page text as markdown
    python3 scripts/fetch-jd.py --setup <url>          Open default browser for login,
                                                        then auto-import session cookies
    python3 scripts/fetch-jd.py --import <domain>      Import cookies from installed
                                                        browsers without opening a browser
    python3 scripts/fetch-jd.py --clear <domain>       Clear saved auth for domain
    python3 scripts/fetch-jd.py --list                 List domains with saved auth

AUTH FLOW
    First time for a site (e.g. LinkedIn):
        python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/jobs/view/123'
        → tries Firefox profile scan first (works automatically, no window needed)
        → if that fails (Atlas, Chrome, Arc, Edge, Brave, etc.): opens a headed
          Playwright Chromium window → log in → press Enter in the terminal
        → saves the full session state (all cookies + localStorage) for the domain

    If already logged in on Firefox:
        python3 scripts/fetch-jd.py --import linkedin.com
        → scans Firefox profiles on disk, no browser window needed

    Subsequent fetches (called automatically by Claude):
        python3 scripts/fetch-jd.py 'https://www.linkedin.com/jobs/view/123'
        → headless, uses saved auth → prints page text to stdout

EXIT CODES
    0  Success
    1  Error — navigation or script failure
    2  Auth required — no saved auth (or expired); run --setup <url> first
    3  Job closed — posting is no longer available or position filled

AUTH STORAGE
    $APPLICANT_DIR/.auth/<domain>.json  (applicant-specific, never committed)
    Requires APPLICANT_DIR env var — source $APP_DIR/.env before running.
    Session cookies expire; re-run --setup or --import when exit code 2 is returned.
"""

import os
import sys
import json
import re
import shutil
import sqlite3
import base64
import hashlib
import platform
import subprocess
import tempfile
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

def _resolve_auth_dir() -> Path:
    if (v := os.environ.get("AUTH_DIR")):
        return Path(v)
    if (app := os.environ.get("APP_DIR")):
        return Path(app) / ".auth"
    print("[error] AUTH_DIR or APP_DIR not set — source $APP_DIR/.env before running", file=sys.stderr)
    sys.exit(1)

AUTH_DIR = _resolve_auth_dir()

# Chromium epoch starts 1601-01-01; Unix epoch starts 1970-01-01
_CHROMIUM_EPOCH_OFFSET_US = 11_644_473_600_000_000

# URL/text signals for auth walls
AUTH_URL_SIGNALS = ["authwall", "signin", "login", "signup", "join", "challenge", "session"]
AUTH_TEXT_SIGNALS = [
    "sign in to linkedin", "join linkedin", "log in to linkedin",
    "please sign in", "please log in", "create an account to",
    "sign in to view", "join to see",
]

JOB_CLOSED_TITLE_SIGNALS = [
    "job no longer available", "no longer available", "job not found",
    "page not found", "404", "job expired", "position filled",
    "this job has been removed", "job has closed",
]

JOB_CLOSED_BODY_SIGNALS = [
    "this job is no longer available",
    "this position has been filled",
    "this job posting has expired",
    "no longer accepting applications",
    "job has been removed",
    "position is no longer open",
    "this job has been closed",
    "this posting has expired",
    "job is no longer active",
    "this role has been filled",
    "this opportunity is no longer available",
    "application is closed",
    "this job has expired",
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
    is_cdp=False → close `ctx` when done.
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


# LinkedIn job description CSS selectors, tried in priority order.
# LinkedIn frequently changes class names; keeping a fallback chain makes this more resilient.
_LINKEDIN_JD_SELECTORS = (
    "#job-details",
    ".jobs-description__content",
    ".jobs-description",
    ".description__text",
    # Newer LinkedIn DOM variants (added 2026-06):
    ".jobs-box__html-content",
    "[class*='jobs-description']",
)

# Text markers that indicate the start of the actual job content on LinkedIn pages.
# Used as a last resort when all CSS selectors fail (LinkedIn frequently restructures).
_LINKEDIN_CONTENT_MARKERS = ("About the job", "About this job", "Job description")

# LinkedIn "See more" expand button selectors, tried in priority order.
# LinkedIn frequently A/B tests button classes; keeping a fallback chain is necessary.
_LINKEDIN_EXPAND_SELECTORS = (
    "button[aria-label='Click to see more description']",        # canonical aria-label, 2023-2025
    "button[aria-label='Show more, visually expands previously read content']",  # 2026 redesign
    ".jobs-description__footer-button",                           # stable BEM class, ~2023+
    "[class*='jobs-description'][class*='footer']",               # covers renamed A/B variants
    ".jobs-description button.inline-show-more-text__button",     # "…more" inline link variant
    ".jobs-description button[aria-expanded='false']",            # aria contract: collapsed button
)

# Footer markers: text that signals the end of job content on LinkedIn full-page extracts.
# Content is trimmed at the first occurrence of any of these.
_LINKEDIN_FOOTER_MARKERS = (
    "\nSelect language\n",              # language-selector nav
    "\nLanguage\n",                     # variant
    "\nSet alert for similar jobs",     # job alert prompt; appears immediately after JD
    "\nMore jobs\n",                    # similar-jobs sidebar section heading
    "\nBenefits found in job post\n",   # LinkedIn benefits section below JD
    "\nSee how you compare",            # skills-match widget for logged-in users
    "\nLooking for talent?\n",          # LinkedIn Recruiter ad copy
    "\nLinkedIn Corporation",           # legal footer
    "\n© LinkedIn",                     # alternate legal footer form
)

DEFAULT_MAX_CHARS = 12000


def _expand_linkedin_jd(page) -> bool:
    """Try to click the LinkedIn "See more" expand button for the job description.

    Iterates through _LINKEDIN_EXPAND_SELECTORS in priority order. Clicks the
    first button that is visible and not disabled, then waits 800ms for the DOM
    to update. Returns True if clicked, False otherwise.

    Called at the top of the LinkedIn branch in _extract_body() before the CSS
    selector chain so extraction runs against the expanded DOM.
    """
    for sel in _LINKEDIN_EXPAND_SELECTORS:
        try:
            btn = page.query_selector(sel)
            if btn and btn.is_visible() and not btn.is_disabled():
                btn.click()
                page.wait_for_timeout(800)
                return True
        except Exception:
            continue
    return False


def _extract_body(page, url: str, max_chars: int | None = DEFAULT_MAX_CHARS) -> str:
    """Extract page body text with LinkedIn-targeted content selection.

    For LinkedIn URLs, tries job-description-specific CSS selectors to avoid
    returning navigation/sidebar boilerplate alongside the actual JD. When all
    selectors miss, scans the body text for a known content marker ("About the
    job", etc.) and extracts from that point. Falls back to full body inner_text
    when no marker is found or for non-LinkedIn URLs.
    Truncates to max_chars if set (default: 12000).
    """
    body = ""
    if "linkedin.com" in url:
        _expand_linkedin_jd(page)
        for sel in _LINKEDIN_JD_SELECTORS:
            try:
                el = page.query_selector(sel)
                if el:
                    text = (el.inner_text() or "").strip()
                    if text:
                        body = text
                        break
            except Exception:
                continue
        if not body:
            full = page.inner_text("body") or ""
            for marker in _LINKEDIN_CONTENT_MARKERS:
                idx = full.find(marker)
                if idx != -1:
                    body = full[idx:]
                    break
            if not body:
                body = full  # no marker found; use full body to avoid a second inner_text("body") call
        if body:
            for footer in _LINKEDIN_FOOTER_MARKERS:
                fidx = body.find(footer)
                if fidx != -1:
                    body = body[:fidx].rstrip()
                    break
    if not body:
        body = page.inner_text("body") or ""
    if max_chars and len(body) > max_chars:
        body = body[:max_chars] + f"\n\n[truncated at {max_chars} chars]"
    return body


def _fetch_with_real_chrome(
    url: str, md_out: str | None, chrome_profile: str, cdp_port: int,
    max_chars: int | None = DEFAULT_MAX_CHARS,
) -> None:
    """Fetch a URL using the user's real Chrome browser (CDP or profile launch)."""
    with sync_playwright() as p:
        ctx, page, is_cdp = _connect_or_launch(p, chrome_profile, cdp_port)
        try:
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(2000)
            except Exception as e:
                print(f"[error] Navigation failed: {e}", file=sys.stderr)
                sys.exit(1)

            title = page.title()
            final_url = page.url
            body = _extract_body(page, url, max_chars)

            if md_out:
                content = f"# {title}\n\nSource: {final_url}\n\n{body}"
                if md_out == "-":
                    print(content)
                else:
                    Path(md_out).write_text(content, encoding="utf-8")
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

    if is_auth_wall(final_url, title, body):
        print(f"[auth-expired] LinkedIn session expired in Chrome.", file=sys.stderr)
        print("Log into LinkedIn in Chrome and retry.", file=sys.stderr)
        sys.exit(2)

    if is_job_closed(title, body):
        print(f"[job-closed] Job posting is no longer available.", file=sys.stderr)
        sys.exit(3)

    print(f"URL: {final_url}")
    print(f"Title: {title}")
    print()
    print(body)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_domain(url: str) -> str:
    host = urlparse(url).netloc
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


def is_job_closed(title: str, body: str) -> bool:
    title_l = title.lower()
    body_l = body[:2000].lower()
    return (
        any(s in title_l for s in JOB_CLOSED_TITLE_SIGNALS)
        or any(s in body_l for s in JOB_CLOSED_BODY_SIGNALS)
    )


def _save_auth(domain: str, cookies: list[dict]) -> None:
    auth_file(domain).write_text(
        json.dumps({"cookies": cookies, "origins": []}, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Cookie decryption
# ---------------------------------------------------------------------------

_macos_passwords_cache: list[bytes] | None = None

# Known Chromium-family Safe Storage names stored in the login keychain.
# Sandboxed browsers (e.g. ChatGPT Atlas) use private keychains that are
# inaccessible externally — they won't be found here and won't prompt.
_MACOS_BROWSER_SAFE_STORAGE_NAMES = [
    "Chrome Safe Storage",
    "Chromium Safe Storage",
    "Microsoft Edge Safe Storage",
    "Brave Safe Storage",
    "Arc Safe Storage",
    "Opera Safe Storage",
    "Opera GX Safe Storage",
    "Vivaldi Safe Storage",
    "Yandex Safe Storage",
    "Coccoc Safe Storage",
    "Blisk Safe Storage",
]


def _macos_safe_storage_passwords() -> list[bytes]:
    """Return Safe Storage passwords from the login Keychain for known browsers.

    Uses a static list of well-known browser names instead of dump-keychain,
    so sandboxed app keychains (which can't be accessed externally) are never
    queried and never trigger spurious password prompts.
    macOS will prompt once per browser on first access; click "Always Allow"
    to make subsequent imports silent.
    """
    global _macos_passwords_cache
    if _macos_passwords_cache is not None:
        return _macos_passwords_cache

    passwords = []
    for svc in _MACOS_BROWSER_SAFE_STORAGE_NAMES:
        r = subprocess.run(
            ["security", "find-generic-password", "-s", svc, "-w"],
            capture_output=True, text=True,
        )
        if r.returncode == 0 and r.stdout.strip():
            passwords.append(r.stdout.strip().encode())

    _macos_passwords_cache = passwords
    return passwords


def _aes_cbc_decrypt(password: bytes, data: bytes) -> str | None:
    """AES-128-CBC decrypt using Chromium's PBKDF2 key derivation."""
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.backends import default_backend
        key = hashlib.pbkdf2_hmac("sha1", password, b"saltysalt", 1003, dklen=16)
        iv = b" " * 16
        cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        dec = cipher.decryptor()
        decrypted = dec.update(data) + dec.finalize()
        pad = decrypted[-1]
        if pad > 16:
            return None
        result = decrypted[:-pad].decode("utf-8", errors="replace")
        return result if result.isprintable() and len(result) > 0 else None
    except Exception:
        return None


def _chromium_decrypt(encrypted_value: bytes, system: str,
                       local_state_path: Path | None = None) -> str:
    """Decrypt a Chromium cookie value. Returns empty string on failure."""
    if not encrypted_value:
        return ""

    prefix = encrypted_value[:3]

    # Unencrypted (plain text stored directly)
    if prefix not in (b"v10", b"v11"):
        try:
            return encrypted_value.decode("utf-8")
        except Exception:
            return ""

    data = encrypted_value[3:]

    if system == "Darwin":
        for pwd in _macos_safe_storage_passwords():
            result = _aes_cbc_decrypt(pwd, data)
            if result is not None:
                return result
        return ""

    if system == "Linux":
        # Try Secretservice first, fall back to fixed "peanuts" key
        candidates: list[bytes] = []
        try:
            import keyring
            v = keyring.get_password("Chrome Keys", "Chrome")
            if v:
                candidates.append(v.encode())
        except Exception:
            pass
        candidates.append(b"peanuts")
        for pwd in candidates:
            result = _aes_cbc_decrypt(pwd, data)
            if result is not None:
                return result
        return ""

    if system == "Windows":
        # AES-GCM with DPAPI-wrapped key stored in Local State
        try:
            import win32crypt
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            if local_state_path and local_state_path.exists():
                ls = json.loads(local_state_path.read_text(encoding="utf-8"))
                enc_key_b64 = ls.get("os_crypt", {}).get("encrypted_key", "")
                if enc_key_b64:
                    enc_key = base64.b64decode(enc_key_b64)[5:]  # strip DPAPI prefix
                    key = win32crypt.CryptUnprotectData(enc_key, None, None, None, 0)[1]
                    nonce = data[3:15]
                    ciphertext = data[15:]
                    return AESGCM(key).decrypt(nonce, ciphertext, None).decode("utf-8")
        except Exception:
            pass
        return ""

    return ""


# ---------------------------------------------------------------------------
# Browser profile scanning
# ---------------------------------------------------------------------------

def _chromium_epoch_to_unix(ts: int) -> float:
    if ts <= 0:
        return -1
    return (ts - _CHROMIUM_EPOCH_OFFSET_US) / 1_000_000


def _read_chromium_cookies(cookies_file: Path, domain: str, system: str) -> list[dict]:
    """Read and decrypt cookies for `domain` from a Chromium Cookies SQLite file."""
    local_state = cookies_file.parent.parent / "Local State"
    tmp = Path(tempfile.mktemp(suffix=".db"))
    try:
        shutil.copy2(str(cookies_file), str(tmp))
        conn = sqlite3.connect(f"file:{tmp}?mode=ro&immutable=1", uri=True)
        rows = conn.execute(
            "SELECT name, value, host_key, path, expires_utc, is_secure, "
            "is_httponly, encrypted_value FROM cookies "
            "WHERE host_key LIKE ? OR host_key LIKE ?",
            (f"%{domain}%", f"%.{domain}%"),
        ).fetchall()
        conn.close()
    except Exception:
        return []
    finally:
        tmp.unlink(missing_ok=True)

    results = []
    for name, value, host_key, path, expires_utc, secure, httponly, enc in rows:
        if not value and enc:
            value = _chromium_decrypt(enc, system, local_state)
        if not value:
            continue
        results.append({
            "name": name,
            "value": value,
            "domain": host_key,
            "path": path or "/",
            "expires": _chromium_epoch_to_unix(expires_utc),
            "httpOnly": bool(httponly),
            "secure": bool(secure),
            "sameSite": "None",
        })
    return results


def _scan_chromium(domain: str) -> list[dict]:
    """Scan all Chromium-family browser profiles for cookies matching domain."""
    system = platform.system()
    home = Path.home()

    if system == "Darwin":
        base = home / "Library" / "Application Support"
        patterns = [
            "*/Default/Cookies",
            "*/*/Default/Cookies",
            "*/*/*/Cookies",        # e.g. Atlas: com.openai.atlas/browser-data/host/.../Cookies
            "*/Profile*/Cookies",
            "*/*/Profile*/Cookies",
        ]
    elif system == "Linux":
        base = home / ".config"
        patterns = ["*/Default/Cookies", "*/Profile*/Cookies"]
    elif system == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA", ""))
        patterns = ["*/User Data/Default/Cookies", "*/User Data/Profile*/Cookies"]
    else:
        return []

    seen: set[Path] = set()
    results: list[dict] = []
    for pattern in patterns:
        for f in base.glob(pattern):
            if f in seen or not f.is_file():
                continue
            seen.add(f)
            results.extend(_read_chromium_cookies(f, domain, system))

    return results


def _read_firefox_cookies(cookies_file: Path, domain: str) -> list[dict]:
    """Read cookies for `domain` from a Firefox cookies.sqlite file."""
    tmp = Path(tempfile.mktemp(suffix=".db"))
    try:
        shutil.copy2(str(cookies_file), str(tmp))
        conn = sqlite3.connect(f"file:{tmp}?mode=ro&immutable=1", uri=True)
        rows = conn.execute(
            "SELECT name, value, host, path, expiry, isSecure, isHttpOnly "
            "FROM moz_cookies WHERE host LIKE ? OR host LIKE ?",
            (f"%{domain}%", f"%.{domain}%"),
        ).fetchall()
        conn.close()
    except Exception:
        return []
    finally:
        tmp.unlink(missing_ok=True)

    return [
        {
            "name": name,
            "value": value,
            "domain": host,
            "path": path or "/",
            "expires": float(expiry) if expiry else -1,
            "httpOnly": bool(httponly),
            "secure": bool(secure),
            "sameSite": "None",
        }
        for name, value, host, path, expiry, secure, httponly in rows
        if value
    ]


def _scan_firefox(domain: str) -> list[dict]:
    """Scan all Firefox-family browser profiles for cookies matching domain."""
    system = platform.system()
    home = Path.home()

    if system == "Darwin":
        base = home / "Library" / "Application Support"
        patterns = ["Firefox/Profiles/*/cookies.sqlite", "*/Profiles/*/cookies.sqlite"]
    elif system == "Linux":
        base = home
        patterns = [".mozilla/firefox/*/cookies.sqlite", ".mozilla/*/Profiles/*/cookies.sqlite"]
    elif system == "Windows":
        base = Path(os.environ.get("APPDATA", ""))
        patterns = ["Mozilla/Firefox/Profiles/*/cookies.sqlite"]
    else:
        return []

    seen: set[Path] = set()
    results: list[dict] = []
    for pattern in patterns:
        for f in base.glob(pattern):
            if f in seen or not f.is_file():
                continue
            seen.add(f)
            results.extend(_read_firefox_cookies(f, domain))

    return results


def import_browser_cookies(domain: str) -> list[dict]:
    """Scan Firefox profiles for cookies matching domain. Returns Playwright dicts.

    Only Firefox is scanned automatically — Firefox cookies are unencrypted on
    all platforms, so no keychain prompts are needed. Chromium-family browsers
    (Chrome, Edge, Brave, Arc, Atlas, etc.) encrypt cookies with a key stored
    in the OS keychain; accessing that key triggers repeated system password
    prompts and is not reliably accessible for all browsers. Those cases fall
    through to manual cookie entry.
    """
    # Deduplicate by (name, domain) — keep last seen
    seen: dict[tuple, dict] = {}
    for c in _scan_firefox(domain):
        seen[(c["name"], c["domain"])] = c
    return list(seen.values())


# ---------------------------------------------------------------------------
# Manual cookie entry fallback
# ---------------------------------------------------------------------------

def _manual_cookie_entry(domain: str) -> None:
    print(f"\n[setup] No cookies found automatically (Firefox not installed or no {domain} session).", file=sys.stderr)
    print(f"[setup] To set up manually:", file=sys.stderr)
    print(f"[setup]   1. Open {domain} in your browser and make sure you're logged in", file=sys.stderr)
    print(f"[setup]   2. Open DevTools: F12 (or Cmd+Option+I on Mac)", file=sys.stderr)
    print(f"[setup]   3. Go to Application → Cookies → {domain}", file=sys.stderr)
    print(f"[setup]   4. Find your session cookie (e.g. 'li_at' for LinkedIn)", file=sys.stderr)
    print(f"[setup]   5. Copy its Value", file=sys.stderr)
    print(file=sys.stderr)
    name = input("Cookie name:  ").strip()
    value = input("Cookie value: ").strip()
    if name and value:
        _save_auth(domain, [{
            "name": name,
            "value": value,
            "domain": f".{domain}",
            "path": "/",
            "expires": -1,
            "httpOnly": True,
            "secure": True,
            "sameSite": "None",
        }])
        print(f"\n[setup] Auth saved for {domain}.")
    else:
        print("[setup] No cookie entered — auth not saved.", file=sys.stderr)
        sys.exit(1)


def _playwright_interactive_login(url: str, domain: str) -> None:
    """Open a headed Playwright Chromium window, wait for login, save full storage state."""
    print(f"\n[setup] Opening a Playwright Chromium window for {domain}...", file=sys.stderr)
    print(f"[setup] Log in in the browser window that appears, then press Enter here.", file=sys.stderr)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"[setup] Navigation warning: {e}", file=sys.stderr)

        input("[setup] Press Enter when you are logged in... ")

        state = ctx.storage_state()
        ctx.close()
        browser.close()

    domain_cookies = [c for c in state.get("cookies", []) if domain in c.get("domain", "")]
    if not domain_cookies:
        print(f"[setup] No cookies found for {domain} — did the login complete?", file=sys.stderr)
        print(f"[setup] Falling back to manual entry.", file=sys.stderr)
        _manual_cookie_entry(domain)
        return

    # Save the full storage state (cookies + localStorage) for richer session context
    auth_file(domain).parent.mkdir(parents=True, exist_ok=True)
    auth_file(domain).write_text(json.dumps(state, indent=2) + "\n")
    print(f"[setup] Saved {len(domain_cookies)} cookies + localStorage for {domain}.", file=sys.stderr)


# ---------------------------------------------------------------------------
# Main commands
# ---------------------------------------------------------------------------

def fetch(
    url: str,
    md_out: str | None = None,
    use_real_chrome: bool = False,
    chrome_profile: str | None = None,
    cdp_port: int = 9222,
    max_chars: int | None = DEFAULT_MAX_CHARS,
) -> None:
    """Fetch a URL using saved auth (default) or real Chrome (--use-real-chrome)."""
    if use_real_chrome:
        if not chrome_profile:
            chrome_profile = _default_chrome_profile()
        _fetch_with_real_chrome(url, md_out, chrome_profile, cdp_port, max_chars)
        return

    domain = get_domain(url)
    saved = auth_file(domain)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(storage_state=str(saved) if saved.exists() else None)
        page = ctx.new_page()

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2000)
        except Exception as e:
            print(f"[error] Navigation failed: {e}", file=sys.stderr)
            ctx.close()
            browser.close()
            sys.exit(1)

        title = page.title()
        final_url = page.url
        body = _extract_body(page, url, max_chars)

        if md_out:
            content = f"# {title}\n\nSource: {final_url}\n\n{body}"
            if md_out == "-":
                print(content)
            else:
                Path(md_out).write_text(content, encoding="utf-8")

        ctx.close()
        browser.close()

    if is_auth_wall(final_url, title, body):
        print(f"[auth-expired] Auth for {domain} has expired.", file=sys.stderr)
        print(f"Re-authenticate:", file=sys.stderr)
        print(f"  python3 scripts/fetch-jd.py --setup '{url}'", file=sys.stderr)
        sys.exit(2)

    if is_job_closed(title, body):
        print(f"[job-closed] Job posting is no longer available.", file=sys.stderr)
        sys.exit(3)

    print(f"URL: {final_url}")
    print(f"Title: {title}")
    print()
    print(body)


def setup(url: str) -> None:
    """Authenticate for a domain and save session cookies.

    Tries in order:
    1. Firefox profile scan (works automatically — Firefox stores cookies unencrypted).
    2. Playwright interactive login — opens a headed Chromium window; works for any
       browser including Atlas, Arc, Chrome, Edge, Brave (their cookies are encrypted
       and cannot be scanned automatically).
    """
    domain = get_domain(url)

    print(f"[setup] Scanning browser profiles for {domain} cookies...", file=sys.stderr)
    cookies = import_browser_cookies(domain)
    if cookies:
        _save_auth(domain, cookies)
        print(f"[setup] Saved {len(cookies)} cookies for {domain}.", file=sys.stderr)
    else:
        _playwright_interactive_login(url, domain)


def cmd_import(domain: str) -> None:
    """Import cookies from installed browsers without opening a browser."""
    print(f"[import] Scanning browser profiles for {domain} cookies...", file=sys.stderr)
    cookies = import_browser_cookies(domain)
    if cookies:
        _save_auth(domain, cookies)
        print(f"[import] Saved {len(cookies)} cookies for {domain}.", file=sys.stderr)
    else:
        _manual_cookie_entry(domain)


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


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Pre-scan for real-Chrome flags and --max-chars before existing arg dispatch
    _use_real_chrome = False
    _chrome_profile: str | None = os.environ.get("CHROME_PROFILE")
    _cdp_port = int(os.environ.get("LINKEDIN_CDP_PORT", "9222"))
    _max_chars: int | None = DEFAULT_MAX_CHARS
    _raw = list(sys.argv[1:])
    _filtered = []
    _i = 0
    while _i < len(_raw):
        if _raw[_i] == "--use-real-chrome":
            _use_real_chrome = True
            _i += 1
        elif _raw[_i] == "--chrome-profile" and _i + 1 < len(_raw):
            _chrome_profile = _raw[_i + 1]
            _i += 2
        elif _raw[_i] == "--cdp-port" and _i + 1 < len(_raw):
            _cdp_port = int(_raw[_i + 1])
            _i += 2
        elif _raw[_i] == "--max-chars" and _i + 1 < len(_raw):
            _max_chars = int(_raw[_i + 1])
            _i += 2
        elif _raw[_i] == "--no-max-chars":
            _max_chars = None
            _i += 1
        else:
            _filtered.append(_raw[_i])
            _i += 1
    args = _filtered

    if not args:
        print(__doc__)
        sys.exit(1)

    if args[0] == "--setup":
        if len(args) < 2:
            print("Usage: fetch-jd.py --setup <url>", file=sys.stderr)
            sys.exit(1)
        setup(args[1])

    elif args[0] == "--import":
        if len(args) < 2:
            print("Usage: fetch-jd.py --import <domain>", file=sys.stderr)
            sys.exit(1)
        cmd_import(args[1])

    elif args[0] == "--clear":
        if len(args) < 2:
            print("Usage: fetch-jd.py --clear <domain>", file=sys.stderr)
            sys.exit(1)
        clear(args[1])

    elif args[0] == "--list":
        list_auth()

    elif args[0] == "--md-out":
        if len(args) < 3:
            print("Usage: fetch-jd.py --md-out <filepath> <url>", file=sys.stderr)
            sys.exit(1)
        fetch(args[2], md_out=args[1], use_real_chrome=_use_real_chrome,
              chrome_profile=_chrome_profile, cdp_port=_cdp_port, max_chars=_max_chars)

    else:
        fetch(args[0], use_real_chrome=_use_real_chrome,
              chrome_profile=_chrome_profile, cdp_port=_cdp_port, max_chars=_max_chars)
