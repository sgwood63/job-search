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
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from conftest import playwright_python

SCRIPTS_DIR = Path(__file__).parent.parent
OUT_DIR = Path(__file__).parent / "test-output"

# Known-stable public ATS job postings (no auth required).
# If a posting is closed (exit 3), replace with a current equivalent.
# Uses Lever and Greenhouse — both return clean HTML that fetch-jd.py handles well.
PUBLIC_JD_URLS = [
    "https://jobs.lever.co/anthropic/",          # Anthropic jobs index (stable, no auth)
    "https://boards.greenhouse.io/anthropic",    # Anthropic Greenhouse (stable, no auth)
]

JOB_CONTENT_SIGNALS = (
    "responsibilities", "qualifications", "requirements",
    "about", "experience", "role", "position",
)


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
                # 2. Content length >= 500 chars
                if len(content) < 500:
                    job_failures.append(f"content too short ({len(content)} chars)")

                # 3. LinkedIn CSS selector used — check stderr for extract diagnostic
                # fetch-jd.py does not emit selector diagnostics to stderr, but the
                # absence of "[auth-expired]" and "[job-closed]" with exit 0 implies
                # content was extracted. We check that content doesn't look like a
                # bare navigation page (heuristic: not dominated by short lines).
                lines = [l for l in content.splitlines() if l.strip()]
                long_lines = [l for l in lines if len(l) > 60]
                if lines and len(long_lines) / len(lines) < 0.1:
                    job_failures.append("content looks like nav/sidebar boilerplate (few long lines)")

                # 4. Content contains at least one job-content signal
                lower = content.lower()
                if not any(sig in lower for sig in JOB_CONTENT_SIGNALS):
                    job_failures.append(
                        f"no job content signals found ({', '.join(JOB_CONTENT_SIGNALS)})"
                    )

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

    @pytest.fixture(params=PUBLIC_JD_URLS, ids=lambda u: u.split("/")[2])
    def public_jd(self, request, tmp_path):
        """Fetch one public ATS URL; yield result dict."""
        url = request.param
        out_file = tmp_path / "jd.md"
        r, content = run_fetch_jd(url, out_file=out_file)
        return {
            "url": url,
            "returncode": r.returncode,
            "stderr": r.stderr,
            "content": content,
            "out_file": out_file,
        }

    def test_exit_code_zero(self, public_jd):
        """Public pages should fetch successfully (exit 0)."""
        rc = public_jd["returncode"]
        if rc == 3:
            pytest.skip(f"Job posting closed: {public_jd['url']} — update PUBLIC_JD_URLS")
        assert rc == 0, (
            f"fetch-jd.py failed for {public_jd['url']} (exit {rc}):\n{public_jd['stderr']}"
        )

    def test_content_length(self, public_jd):
        """Fetched content must be at least 200 chars."""
        if public_jd["returncode"] != 0:
            pytest.skip("Skipping content check — fetch failed")
        assert len(public_jd["content"]) >= 200, (
            f"Content too short ({len(public_jd['content'])} chars) for {public_jd['url']}"
        )

    def test_content_is_job_like(self, public_jd):
        """Content must contain at least one job-content signal word."""
        if public_jd["returncode"] != 0:
            pytest.skip("Skipping content check — fetch failed")
        lower = public_jd["content"].lower()
        assert any(sig in lower for sig in JOB_CONTENT_SIGNALS), (
            f"No job-content signals found in {public_jd['url']}.\n"
            f"Signals checked: {JOB_CONTENT_SIGNALS}\n"
            f"Content preview: {public_jd['content'][:300]}"
        )

    def test_not_auth_wall(self, public_jd):
        """Public pages must not return exit 2 (auth required)."""
        assert public_jd["returncode"] != 2, (
            f"Unexpected auth wall on public URL: {public_jd['url']}"
        )
