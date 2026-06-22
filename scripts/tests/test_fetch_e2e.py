"""
End-to-end tests for fetch-linkedin-recs.py and fetch-jd.py.

Three test tiers — select with pytest -m:

    pytest scripts/tests/ -m e2e          # all E2E (LinkedIn auth required)
    pytest scripts/tests/ -m e2e_jd       # JD fetch tests only (LinkedIn + public)
    pytest scripts/tests/ -m e2e_public   # public ATS URLs only — safe for CI, no auth

These tests are skipped in the default test run (no -m flag).

Auth requirements:
    LinkedIn tests: CHROME_PROFILE set in .env + Chrome installed, OR Firefox
                    with an active LinkedIn session.
    Public tests:   None — headless Chromium, no auth.

Raw output is saved to scripts/tests/test-output/ for post-run inspection.

Public URL note:
    PUBLIC_JD_URLS below are real Greenhouse/Lever postings used as stable
    headless-fetch targets. Individual postings expire — update this list when
    a URL starts returning exit code 3 (job closed).
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from conftest import playwright_python

SCRIPTS_DIR = Path(__file__).parent.parent
OUT_DIR = Path(__file__).parent / "test-output"

_DATA_FILE = Path(__file__).parent / "data" / "public-jd-urls.json"
_PUBLIC_JD_DATA = json.loads(_DATA_FILE.read_text())["urls"]
PUBLIC_JD_URLS = [entry["url"] for entry in _PUBLIC_JD_DATA]

_ROLE_SIGNALS = (
    "responsibilities", "you will", "what you'll do",
    "the role", "about this role", "job description", "about the job",
)
_REQ_SIGNALS = (
    "requirements", "qualifications", "what we're looking for",
    "must have", "you have", "you bring", "experience", "skills",
)


def _assess_jd_quality(content: str) -> list:
    """Return a list of failure reasons; empty list means job-search acceptable."""
    failures = []
    if len(content) < 500:
        failures.append(f"too short ({len(content)} chars; min 500)")
    lower = content.lower()
    if not any(s in lower for s in _ROLE_SIGNALS + _REQ_SIGNALS):
        failures.append("no role-description or requirements signals found")
    lines = [line for line in content.splitlines() if line.strip()]
    if lines:
        long_lines = [line for line in lines if len(line) > 60]
        if len(long_lines) / len(lines) < 0.1:
            failures.append("content is nav/sidebar boilerplate (< 10% of lines exceed 60 chars)")
    if any(s in content[:500].lower() for s in ("sign in to", "log in to", "create an account")):
        failures.append("auth-wall text detected in first 500 chars")
    return failures


def _plain_http_get(url: str, timeout: int = 15):
    """Simulate WebFetch: plain HTTP GET without Playwright or auth.
    Returns (body_html, title, final_url).
    Reads HTTPError response bodies so auth-wall redirects are inspectable.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            html = r.read().decode("utf-8", errors="replace")
            final_url = r.url
    except urllib.error.HTTPError as exc:
        try:
            html = exc.read().decode("utf-8", errors="replace")
        except Exception:
            html = str(exc)
        final_url = exc.url or url
    except Exception as exc:
        return str(exc), "", url
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = m.group(1).strip() if m else ""
    return html, title, final_url


# ── Helpers ───────────────────────────────────────────────────────────────────

def run_fetch_linkedin(extra_args=(), timeout=180):
    """Run fetch-linkedin-recs.py and return CompletedProcess."""
    return subprocess.run(
        [playwright_python(), str(SCRIPTS_DIR / "fetch-linkedin-recs.py"), *extra_args],
        capture_output=True,
        text=True,
        timeout=timeout,
        env=os.environ.copy(),
    )


def run_fetch_jd(url, extra_args=(), out_file=None, timeout=60):
    """Run fetch-jd.py for a single URL. Returns (CompletedProcess, content_str)."""
    cmd = [playwright_python(), str(SCRIPTS_DIR / "fetch-jd.py")]
    if out_file:
        cmd += ["--md-out", str(out_file)]
    cmd += list(extra_args)
    cmd.append(url)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=os.environ.copy(),
    )
    content = ""
    if out_file and out_file.exists():
        content = out_file.read_text()
    elif result.returncode == 0 and not out_file:
        content = result.stdout
    return result, content


# ── Session fixtures ──────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def search_page1():
    """
    Fetch LinkedIn recommended feed page 1 once per E2E session.
    Saves raw JSON to test-output/search-page1.json.
    Skips (not fails) if LinkedIn auth is not set up.
    """
    OUT_DIR.mkdir(exist_ok=True)
    result = run_fetch_linkedin(["--max-pages", "1"])
    if result.returncode == 2:
        pytest.skip("LinkedIn auth not set up — configure CHROME_PROFILE or run Firefox --setup first")
    assert result.returncode == 0, (
        f"fetch-linkedin-recs.py failed (exit {result.returncode}):\n{result.stderr}"
    )
    data = json.loads(result.stdout)
    (OUT_DIR / "search-page1.json").write_text(result.stdout)
    return data


@pytest.fixture(scope="session")
def jd_results(search_page1):
    """
    Fetch all job descriptions from page 1 of search results using headless
    Playwright + saved LinkedIn auth (matching how the real search-jobs-linkedin
    workflow calls fetch-jd.py — no --use-real-chrome).

    Saves each JD to test-output/jds/<job_id>.md.
    Respects JD_DELAY_SECONDS env var (default 10s) between fetches.
    Bails immediately (pytest.skip) on auth failure (exit 2) mid-run.
    """
    jd_delay = int(os.environ.get("JD_DELAY_SECONDS", "10"))
    jds_dir = OUT_DIR / "jds"
    jds_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for job in search_page1["jobs"]:
        url = job["apply_link"]
        out_file = jds_dir / f"{job['job_id']}.md"
        r, content = run_fetch_jd(url, out_file=out_file)
        if r.returncode == 2:
            pytest.skip(
                f"LinkedIn auth expired during JD fetch for {job['job_id']} — "
                "re-run: python3 scripts/fetch-jd.py --setup 'https://www.linkedin.com/login'"
            )
        results.append({
            "job_id": job["job_id"],
            "url": url,
            "returncode": r.returncode,
            "stderr": r.stderr,
            "content": content,
            "out_file": out_file,
        })
        if r.returncode != 3:  # exit 3 = job closed instantly; no delay needed
            time.sleep(jd_delay)

    return results


# ── Search tests ──────────────────────────────────────────────────────────────

@pytest.mark.e2e
class TestFetchLinkedinRecsE2E:

    def test_output_schema(self, search_page1):
        """JSON output has required top-level fields and valid job entries."""
        data = search_page1
        assert data["source"] in ("linkedin-recommended", "linkedin-search"), (
            f"Unexpected source: {data['source']}"
        )
        assert isinstance(data["jobs"], list) and len(data["jobs"]) > 0, (
            "Expected at least one job in page 1 results"
        )
        assert data["pages_fetched"] == 1
        for job in data["jobs"]:
            assert job.get("job_id"), f"Job missing job_id: {job}"
            assert "/jobs/view/" in job.get("apply_link", ""), (
                f"Job {job.get('job_id')} has unexpected apply_link: {job.get('apply_link')}"
            )

    def test_page1_job_count(self, search_page1):
        """
        Page 1 should return up to PAGE_SIZE (25) jobs.
        If fewer than 25 are returned, it implies this is the only page.
        """
        jobs = search_page1["jobs"]
        count = len(jobs)
        assert count >= 1, "Expected at least 1 job"
        if count < 25:
            # Feed has fewer than a full page — confirm only 1 page was available
            assert search_page1["pages_fetched"] == 1, (
                f"Got {count} jobs but pages_fetched={search_page1['pages_fetched']} (expected 1)"
            )

    def test_pagination(self, search_page1):
        """
        When page 1 is full (25 jobs), fetching 2 pages should return more jobs
        with no ID overlap between pages.
        """
        if len(search_page1["jobs"]) < 25:
            pytest.skip("Page 1 had fewer than 25 jobs — pagination not expected")

        page1_ids = {j["job_id"] for j in search_page1["jobs"]}

        result = run_fetch_linkedin(["--max-pages", "2"])
        if result.returncode == 2:
            pytest.skip("LinkedIn auth not set up")
        assert result.returncode == 0, result.stderr

        data2 = json.loads(result.stdout)
        assert data2["pages_fetched"] == 2, (
            f"Expected 2 pages fetched, got {data2['pages_fetched']}"
        )
        assert len(data2["jobs"]) >= 25, (
            f"Expected ≥25 total jobs across 2 pages, got {len(data2['jobs'])}"
        )
        page2_only_ids = {j["job_id"] for j in data2["jobs"]} - page1_ids
        assert len(page2_only_ids) > 0, "Page 2 returned no new job IDs"


# ── LinkedIn JD fetch tests ───────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.e2e_jd
class TestFetchJdE2E:
    """JD fetch tests using headless Playwright + saved auth (mirrors real ingest workflow)."""

    def test_jd_fetch_all_jobs(self, jd_results):
        """
        For every job on page 1, assert all 4 quality criteria.
        Collects failures per job and reports a summary — does not fail on first job.
        """
        failures = []
        for r in jd_results:
            job_id = r["job_id"]
            rc = r["returncode"]
            content = r["content"]
            stderr = r["stderr"]

            job_failures = []

            # 1. Exit code 0
            if rc != 0:
                job_failures.append(f"exit code {rc} (stderr: {stderr[:200]})")

            if rc == 0:
                job_failures.extend(_assess_jd_quality(content))

            if job_failures:
                failures.append(f"  job_id={job_id} url={r['url']}: " + "; ".join(job_failures))

        assert not failures, (
            f"{len(failures)} job(s) failed assertions:\n" + "\n".join(failures)
        )

    def test_no_auth_failures(self, jd_results):
        """Auth must not expire mid-run — zero exit-code-2 results expected."""
        auth_failures = [r for r in jd_results if r["returncode"] == 2]
        assert not auth_failures, (
            f"Auth expired for {len(auth_failures)} job(s): "
            + ", ".join(r["job_id"] for r in auth_failures)
        )

    def test_output_files_saved(self, jd_results):
        """All successful fetches must have a non-empty output file."""
        missing = []
        for r in jd_results:
            if r["returncode"] == 0:
                f = r["out_file"]
                if not f.exists() or f.stat().st_size == 0:
                    missing.append(r["job_id"])
        assert not missing, f"Missing/empty output files for job_id(s): {missing}"


# ── Public URL tests (CI-safe, no auth) ──────────────────────────────────────

@pytest.mark.e2e_public
@pytest.mark.e2e_jd
class TestFetchJdPublicE2E:
    """
    Tests fetch-jd.py in headless mode against public (no-auth) ATS pages.
    Safe for CI environments — no LinkedIn auth required.

    If a URL starts returning exit 3 (job closed), replace it in PUBLIC_JD_URLS.
    """

    @pytest.fixture(params=_PUBLIC_JD_DATA, ids=lambda e: e["label"])
    def public_jd(self, request, tmp_path):
        """Fetch one public ATS URL; yield result dict."""
        entry = request.param
        url = entry["url"]
        out_file = tmp_path / "jd.md"
        r, content = run_fetch_jd(url, out_file=out_file)
        return {
            "url": url,
            "label": entry["label"],
            "individual_jd": entry.get("individual_jd", False),
            "skip_content_check": entry.get("skip_content_check", False),
            "returncode": r.returncode,
            "stderr": r.stderr,
            "content": content,
            "out_file": out_file,
        }

    def test_exit_code_zero(self, public_jd):
        """Public pages should fetch successfully (exit 0)."""
        rc = public_jd["returncode"]
        if rc == 3:
            pytest.skip(
                f"Job posting closed: {public_jd['url']} — "
                "refresh via search_chunks_semantic and update public-jd-urls.json"
            )
        assert rc == 0, (
            f"fetch-jd.py failed for {public_jd['url']} (exit {rc}):\n{public_jd['stderr']}"
        )

    def test_content_length(self, public_jd):
        """Fetched content must be at least 500 chars."""
        if public_jd["returncode"] != 0:
            pytest.skip("Skipping content check — fetch failed")
        if public_jd.get("skip_content_check"):
            pytest.skip("Skipping content check — JS-rendered site, no extractable text")
        assert len(public_jd["content"]) >= 500, (
            f"Content too short ({len(public_jd['content'])} chars) for {public_jd['url']}"
        )

    def test_content_is_job_like(self, public_jd):
        """Content must pass the job-search quality rubric."""
        if public_jd["returncode"] != 0:
            pytest.skip("Skipping quality check — fetch failed")
        if not public_jd["individual_jd"]:
            pytest.skip("Skipping quality check — index listing page, not an individual JD")
        failures = _assess_jd_quality(public_jd["content"])
        assert not failures, (
            f"JD quality check failed for {public_jd['url']}:\n"
            + "\n".join(f"  - {f}" for f in failures)
            + f"\nContent preview:\n{public_jd['content'][:400]}"
            + "\n[If this site consistently fails, consider adding site-specific selectors to _extract_body()]"
        )

    def test_not_auth_wall(self, public_jd):
        """Public pages must not return exit 2 (auth required)."""
        assert public_jd["returncode"] != 2, (
            f"Unexpected auth wall on public URL: {public_jd['url']}"
        )


# ── Stdout / workflow integration tests ───────────────────────────────────────

@pytest.mark.e2e_public
@pytest.mark.e2e_jd
class TestFetchJdStdoutE2E:
    """
    Tests the --md-out - stdout invocation path used by the search-jobs workflow:
        fetch-jd.py --md-out - <url>
    Validates: markdown format on stdout, quality of content, and correct
    exit-code routing (auth failure → empty stdout, error to stderr only).
    """

    def test_stdout_markdown_format(self):
        """--md-out - outputs a markdown header to stdout and exits 0."""
        url = "https://boards.greenhouse.io/anthropic"
        result = subprocess.run(
            [playwright_python(), str(SCRIPTS_DIR / "fetch-jd.py"), "--md-out", "-", url],
            capture_output=True, text=True, timeout=60, env=os.environ.copy(),
        )
        if result.returncode == 3:
            pytest.skip(f"Job listing closed: {url} — update URL in data file")
        assert result.returncode == 0, (
            f"exit {result.returncode}\nstderr: {result.stderr}"
        )
        assert result.stdout.startswith("# "), (
            f"stdout should open with markdown header '# <Title>'; got: {result.stdout[:100]!r}"
        )
        assert "\nSource: " in result.stdout, "stdout must contain 'Source: <url>' line"

    def test_stdout_content_quality(self):
        """Content written to stdout for an individual JD must pass the quality rubric.

        Uses the first individual_jd entry from the data file. Index listing pages
        (Greenhouse/Lever indexes) do not pass the single-JD rubric — they list many
        jobs but have no individual requirements/responsibilities sections.
        """
        individual_entries = [e for e in _PUBLIC_JD_DATA if e.get("individual_jd")]
        if not individual_entries:
            pytest.skip("No individual_jd entries in public-jd-urls.json")
        entry = individual_entries[0]
        url = entry["url"]
        result = subprocess.run(
            [playwright_python(), str(SCRIPTS_DIR / "fetch-jd.py"), "--md-out", "-", url],
            capture_output=True, text=True, timeout=60, env=os.environ.copy(),
        )
        if result.returncode == 3:
            pytest.skip(
                f"Job closed: {url} — "
                "refresh via search_chunks_semantic and update public-jd-urls.json"
            )
        if result.returncode != 0:
            pytest.skip(f"Skipping quality check — fetch failed (exit {result.returncode})")
        failures = _assess_jd_quality(result.stdout)
        assert not failures, (
            f"stdout content failed quality check for {url}:\n"
            + "\n".join(f"  - {f}" for f in failures)
        )

    def test_stdout_exit_code_on_auth_failure(self, tmp_auth_dir):
        """On auth failure, exit code must be 2 and stderr must name the auth error.

        fetch-jd.py writes the auth-wall page content to stdout before detecting the
        auth wall — the workflow discards stdout by checking the exit code, not by
        checking whether stdout is empty.
        """
        env = {**os.environ, "APP_DIR": str(tmp_auth_dir), "AUTH_DIR": str(tmp_auth_dir / ".auth")}
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "fetch-jd.py"),
             "--md-out", "-", "https://www.linkedin.com/feed/"],
            capture_output=True, text=True, timeout=30, env=env,
        )
        assert result.returncode == 2, (
            f"Expected exit 2 on auth failure; got {result.returncode}\n"
            f"stderr: {result.stderr[:200]!r}"
        )
        assert "auth" in result.stderr.lower() or "expired" in result.stderr.lower(), (
            f"Expected auth error message in stderr; got: {result.stderr[:200]!r}"
        )


# ── WebFetch → fetch-jd.py fallback routing tests ────────────────────────────

@pytest.mark.e2e_public
class TestWebFetchFallbackE2E:
    """
    Tests the behavioral contract behind the WebFetch→fetch-jd.py routing decision.

    The search-jobs workflow tries WebFetch (plain HTTP) first and falls back to
    fetch-jd.py only when is_auth_wall() returns True on the WebFetch response.
    These tests validate that the routing logic is correct for the sites we encounter.
    """

    @pytest.mark.parametrize("url", [
        "https://boards.greenhouse.io/anthropic",
        "https://jobs.lever.co/anthropic/",
        "https://attio.com/careers",
    ])
    def test_public_sites_pass_webfetch_no_fallback_needed(self, url, fetch_jd):
        """Public ATS/careers pages: plain HTTP → is_auth_wall() False → no fetch-jd.py needed."""
        html, title, final_url = _plain_http_get(url)
        result = fetch_jd.is_auth_wall(final_url, title, html[:800])
        assert not result, (
            f"Plain HTTP fetch of {url} was incorrectly flagged as auth wall.\n"
            f"Final URL: {final_url}\nTitle: {title!r}\nBody preview: {html[:300]!r}"
        )

    def test_linkedin_triggers_webfetch_fallback(self, fetch_jd):
        """LinkedIn: plain HTTP returns auth wall → is_auth_wall() True → fetch-jd.py fallback triggered."""
        url = "https://www.linkedin.com/feed/"
        html, title, final_url = _plain_http_get(url)
        result = fetch_jd.is_auth_wall(final_url, title, html[:800])
        assert result, (
            f"Expected plain HTTP fetch of LinkedIn /feed/ to be flagged as auth wall, but it wasn't.\n"
            f"Final URL: {final_url}\nTitle: {title!r}\nBody preview: {html[:300]!r}"
        )

    def test_unknown_site_no_false_auth_wall(self, fetch_jd):
        """A completely novel site (Ashby) should not trigger false auth-wall detection."""
        url = "https://jobs.ashbyhq.com/anthropic"
        html, title, final_url = _plain_http_get(url)
        if "sign in" in title.lower() or "log in" in title.lower():
            pytest.skip(f"Site returned a login page — may require auth: {title!r}")
        result = fetch_jd.is_auth_wall(final_url, title, html[:800])
        assert not result, (
            f"Novel ATS site {url} was incorrectly detected as auth wall.\n"
            f"Title: {title!r}\nBody preview: {html[:300]!r}"
        )
