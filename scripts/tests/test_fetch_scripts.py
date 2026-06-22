"""
Unit and mock tests for scripts/fetch-linkedin-recs.py and scripts/fetch-jd.py.

These tests are fully hermetic — no network, no browser, no real files.
Playwright is NOT launched; page objects are replaced with MagicMock instances.

Run:
    pytest scripts/tests/test_fetch_scripts.py -v
"""
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# conftest.py sets APP_DIR before this file is collected, satisfying the
# module-level _resolve_auth_dir() call in both scripts.

SCRIPTS_DIR = Path(__file__).parent.parent


# ── Mock page helpers ─────────────────────────────────────────────────────────

def make_mock_element(inner_text="", attributes=None, visible=True, disabled=False):
    """Create a mock Playwright element."""
    el = MagicMock()
    el.inner_text.return_value = inner_text
    el.get_attribute.side_effect = lambda name: (attributes or {}).get(name, "")
    el.is_visible.return_value = visible
    el.is_disabled.return_value = disabled
    el.query_selector.return_value = None
    return el


def make_mock_page(elements_by_selector=None, body_text="", url="https://example.com"):
    """
    Create a mock Playwright page.

    elements_by_selector: dict mapping CSS selector string → list of mock elements.
    Any selector not in the dict returns [].
    page.inner_text("body") returns body_text.
    """
    page = MagicMock()
    elems = elements_by_selector or {}
    page.query_selector_all.side_effect = lambda sel: elems.get(sel, [])
    page.query_selector.side_effect = lambda sel: (elems.get(sel) or [None])[0]
    # page.inner_text("body") — called with a positional CSS selector argument
    page.inner_text.return_value = body_text
    page.url = url
    return page


# ─────────────────────────────────────────────────────────────────────────────
# fetch-linkedin-recs.py
# ─────────────────────────────────────────────────────────────────────────────

class TestFetchLinkedinRecs:

    # ── _is_auth_wall ─────────────────────────────────────────────────────────
    # _AUTH_URL_SIGNALS = ["authwall", "signin", "login", "signup", "join",
    #                      "challenge", "checkpoint"]
    # NOTE: "session" is NOT in this list (it IS in fetch-jd.py).

    def test_url_authwall_signal(self, fetch_linkedin):
        assert fetch_linkedin._is_auth_wall(
            "https://linkedin.com/authwall?trk=x", "LinkedIn", ""
        )

    def test_url_signin_signal(self, fetch_linkedin):
        assert fetch_linkedin._is_auth_wall(
            "https://linkedin.com/signin", "LinkedIn", ""
        )

    def test_url_checkpoint_signal(self, fetch_linkedin):
        # "checkpoint" is in fetch-linkedin-recs but NOT in fetch-jd.py
        assert fetch_linkedin._is_auth_wall(
            "https://linkedin.com/checkpoint/login", "LinkedIn", ""
        )

    def test_url_session_not_a_signal(self, fetch_linkedin):
        # "session" is NOT in fetch-linkedin-recs _AUTH_URL_SIGNALS
        assert not fetch_linkedin._is_auth_wall(
            "https://linkedin.com/session/expired", "Title", ""
        )

    def test_title_sign_in(self, fetch_linkedin):
        assert fetch_linkedin._is_auth_wall(
            "https://linkedin.com/jobs/view/1", "Sign In to LinkedIn", ""
        )

    def test_title_log_in(self, fetch_linkedin):
        assert fetch_linkedin._is_auth_wall(
            "https://linkedin.com/jobs/view/1", "Log In to Continue", ""
        )

    def test_body_sign_in_to_linkedin(self, fetch_linkedin):
        assert fetch_linkedin._is_auth_wall(
            "https://linkedin.com/jobs/view/1", "Page", "sign in to linkedin"
        )

    def test_clean_page_returns_false(self, fetch_linkedin):
        assert not fetch_linkedin._is_auth_wall(
            "https://linkedin.com/jobs/view/1", "Senior Engineer at Acme", "Join us today"
        )

    # ── _job_id_from_url ──────────────────────────────────────────────────────

    def test_standard_url(self, fetch_linkedin):
        assert fetch_linkedin._job_id_from_url(
            "https://www.linkedin.com/jobs/view/12345"
        ) == "12345"

    def test_trailing_slash(self, fetch_linkedin):
        assert fetch_linkedin._job_id_from_url(
            "https://www.linkedin.com/jobs/view/99999/"
        ) == "99999"

    def test_url_with_query_params(self, fetch_linkedin):
        assert fetch_linkedin._job_id_from_url(
            "https://www.linkedin.com/jobs/view/55555?trk=foo&refId=bar"
        ) == "55555"

    def test_no_match_returns_none(self, fetch_linkedin):
        assert fetch_linkedin._job_id_from_url("https://www.linkedin.com/feed/") is None

    # ── _make_job ─────────────────────────────────────────────────────────────

    def test_required_keys(self, fetch_linkedin):
        job = fetch_linkedin._make_job("42", "linkedin-recommended")
        for key in ("job_id", "title", "company", "location", "apply_link", "posted_at", "raw"):
            assert key in job, f"missing key: {key}"

    def test_apply_link_format(self, fetch_linkedin):
        job = fetch_linkedin._make_job("12345", "linkedin-recommended")
        assert job["apply_link"] == "https://www.linkedin.com/jobs/view/12345/"

    def test_source_propagated_to_raw(self, fetch_linkedin):
        job = fetch_linkedin._make_job("1", "linkedin-search")
        assert job["raw"]["source"] == "linkedin-search"

    def test_job_id_in_raw(self, fetch_linkedin):
        job = fetch_linkedin._make_job("77", "linkedin-recommended")
        assert job["raw"]["job_id"] == "77"

    # ── _extract_cards ────────────────────────────────────────────────────────

    def test_primary_selector_data_occludable(self, fetch_linkedin):
        card = make_mock_element(attributes={"data-occludable-job-id": "12345"})
        page = make_mock_page({"li[data-occludable-job-id]": [card]})
        jobs = fetch_linkedin._extract_cards(page, "linkedin-recommended")
        assert len(jobs) == 1
        assert jobs[0]["job_id"] == "12345"

    def test_urn_selector(self, fetch_linkedin):
        card = make_mock_element(
            attributes={"data-entity-urn": "urn:li:jobPosting:99999"}
        )
        page = make_mock_page({"[data-entity-urn*='jobPosting:']": [card]})
        jobs = fetch_linkedin._extract_cards(page, "linkedin-recommended")
        assert len(jobs) == 1
        assert jobs[0]["job_id"] == "99999"

    def test_fallback_card_container_link(self, fetch_linkedin):
        link = make_mock_element(
            attributes={"href": "https://www.linkedin.com/jobs/view/77777/"}
        )
        page = make_mock_page({"a.job-card-container__link[href*=\"/jobs/view/\"]": [link]})
        jobs = fetch_linkedin._extract_cards(page, "linkedin-recommended")
        assert len(jobs) == 1
        assert jobs[0]["job_id"] == "77777"

    def test_fallback_any_jobs_view_link(self, fetch_linkedin):
        link = make_mock_element(
            attributes={"href": "https://www.linkedin.com/jobs/view/33333/"}
        )
        page = make_mock_page({"a[href*=\"/jobs/view/\"]": [link]})
        jobs = fetch_linkedin._extract_cards(page, "linkedin-recommended")
        assert len(jobs) == 1
        assert jobs[0]["job_id"] == "33333"

    def test_empty_page_returns_empty_list(self, fetch_linkedin):
        page = make_mock_page()
        jobs = fetch_linkedin._extract_cards(page, "linkedin-recommended")
        assert jobs == []

    def test_deduplication_same_id(self, fetch_linkedin):
        card1 = make_mock_element(attributes={"data-occludable-job-id": "55555"})
        card2 = make_mock_element(attributes={"data-occludable-job-id": "55555"})
        page = make_mock_page({"li[data-occludable-job-id]": [card1, card2]})
        jobs = fetch_linkedin._extract_cards(page, "linkedin-recommended")
        assert len(jobs) == 1

    # ── Exit code via subprocess ──────────────────────────────────────────────

    def test_exit_code_2_no_auth_file(self, tmp_auth_dir):
        # tmp_auth_dir sets APP_DIR to a temp dir with an empty .auth/ dir.
        # No linkedin.com.json exists → script should exit 2 (auth required).
        env = {**os.environ, "APP_DIR": str(tmp_auth_dir)}
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "fetch-linkedin-recs.py")],
            capture_output=True,
            timeout=15,
            env=env,
        )
        assert result.returncode == 2, (
            f"Expected exit 2 (auth required), got {result.returncode}.\n"
            f"stderr: {result.stderr.decode()}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# fetch-jd.py
# ─────────────────────────────────────────────────────────────────────────────

class TestFetchJd:

    # ── get_domain ────────────────────────────────────────────────────────────

    def test_strips_www(self, fetch_jd):
        assert fetch_jd.get_domain("https://www.linkedin.com/jobs/view/1") == "linkedin.com"

    def test_no_www(self, fetch_jd):
        assert fetch_jd.get_domain("https://linkedin.com/jobs/view/1") == "linkedin.com"

    def test_subdomain_kept(self, fetch_jd):
        assert fetch_jd.get_domain("https://jobs.lever.co/acme/123") == "jobs.lever.co"

    def test_path_not_included(self, fetch_jd):
        domain = fetch_jd.get_domain("https://greenhouse.io/apply/for/job")
        assert "/" not in domain

    # ── is_auth_wall ──────────────────────────────────────────────────────────
    # AUTH_URL_SIGNALS = ["authwall", "signin", "login", "signup", "join",
    #                     "challenge", "session"]
    # NOTE: "session" IS here but "checkpoint" is NOT (opposite of fetch-linkedin-recs).

    def test_url_authwall(self, fetch_jd):
        assert fetch_jd.is_auth_wall("https://linkedin.com/authwall", "T", "")

    def test_url_session(self, fetch_jd):
        # "session" IS in fetch-jd AUTH_URL_SIGNALS; NOT in fetch-linkedin-recs
        assert fetch_jd.is_auth_wall("https://linkedin.com/session/expired", "T", "")

    def test_url_checkpoint_not_a_signal(self, fetch_jd):
        # "checkpoint" is NOT in fetch-jd AUTH_URL_SIGNALS (it IS in fetch-linkedin-recs).
        # Use a URL that contains only "checkpoint" — no other signals like "login".
        assert not fetch_jd.is_auth_wall(
            "https://linkedin.com/checkpoint/verifyIdentifier", "Page", "normal body"
        )

    def test_title_sign_in(self, fetch_jd):
        assert fetch_jd.is_auth_wall("https://linkedin.com/jobs/view/1", "Sign In", "")

    def test_title_log_in(self, fetch_jd):
        assert fetch_jd.is_auth_wall("https://linkedin.com/jobs/view/1", "Log in", "")

    def test_body_sign_in_to_linkedin(self, fetch_jd):
        assert fetch_jd.is_auth_wall(
            "https://linkedin.com/jobs/view/1", "T", "sign in to linkedin to view this"
        )

    def test_body_join_linkedin(self, fetch_jd):
        assert fetch_jd.is_auth_wall(
            "https://linkedin.com/jobs/view/1", "T", "join linkedin today"
        )

    def test_clean_page_returns_false(self, fetch_jd):
        assert not fetch_jd.is_auth_wall(
            "https://linkedin.com/jobs/view/1",
            "Senior Engineer at Acme",
            "We are looking for a talented engineer",
        )

    def test_body_signal_beyond_800_chars_not_matched(self, fetch_jd):
        # is_auth_wall checks body[:800] — signal placed past that boundary
        padding = "x" * 850
        body = padding + "sign in to linkedin"
        assert not fetch_jd.is_auth_wall("https://linkedin.com/jobs/view/1", "T", body)

    # ── is_job_closed ─────────────────────────────────────────────────────────

    def test_title_position_filled(self, fetch_jd):
        assert fetch_jd.is_job_closed("Position Filled", "")

    def test_title_404(self, fetch_jd):
        assert fetch_jd.is_job_closed("404", "")

    def test_title_no_longer_available(self, fetch_jd):
        assert fetch_jd.is_job_closed("Job No Longer Available", "")

    def test_body_no_longer_available(self, fetch_jd):
        assert fetch_jd.is_job_closed("Some Title", "this job is no longer available")

    def test_body_position_filled(self, fetch_jd):
        assert fetch_jd.is_job_closed("T", "this position has been filled")

    def test_open_job_returns_false(self, fetch_jd):
        assert not fetch_jd.is_job_closed(
            "Senior Engineer at Acme", "We are growing our team"
        )

    def test_body_signal_beyond_2000_chars_not_matched(self, fetch_jd):
        # is_job_closed checks body[:2000]
        padding = "y" * 2100
        body = padding + "this job is no longer available"
        assert not fetch_jd.is_job_closed("Normal Title", body)

    # ── _extract_body ─────────────────────────────────────────────────────────
    # For LinkedIn URLs: tries _LINKEDIN_JD_SELECTORS chain (#job-details first).
    # For non-LinkedIn: calls page.inner_text("body") immediately.
    # Truncates at max_chars when set.
    #
    # Important distinction:
    #   page.inner_text("body")  — page-level method call with "body" arg
    #   el.inner_text()          — element-level call with no args

    def test_linkedin_uses_css_selector(self, fetch_jd):
        el = make_mock_element(inner_text="Job description text here")
        page = make_mock_page({"#job-details": [el]}, body_text="full page body")
        result = fetch_jd._extract_body(page, "https://www.linkedin.com/jobs/view/1")
        assert result == "Job description text here"
        # page.inner_text("body") should NOT have been called
        page.inner_text.assert_not_called()

    def test_linkedin_tries_next_selector_when_first_empty(self, fetch_jd):
        empty_el = make_mock_element(inner_text="")
        content_el = make_mock_element(inner_text="Content from second selector")
        page = make_mock_page({
            "#job-details": [empty_el],
            ".jobs-description__content": [content_el],
        })
        result = fetch_jd._extract_body(page, "https://www.linkedin.com/jobs/view/1")
        assert result == "Content from second selector"

    def test_linkedin_falls_back_to_body_when_all_selectors_fail(self, fetch_jd):
        page = make_mock_page({}, body_text="full body fallback text")
        # All selectors return None (not in dict → query_selector returns None)
        result = fetch_jd._extract_body(page, "https://www.linkedin.com/jobs/view/1")
        assert result == "full body fallback text"
        page.inner_text.assert_called_once_with("body")

    def test_non_linkedin_uses_body_directly(self, fetch_jd):
        page = make_mock_page({}, body_text="greenhouse job body")
        result = fetch_jd._extract_body(page, "https://boards.greenhouse.io/acme/jobs/1")
        assert result == "greenhouse job body"
        page.inner_text.assert_called_once_with("body")
        # query_selector should not have been called for LinkedIn selectors
        page.query_selector.assert_not_called()

    def test_truncation_at_max_chars(self, fetch_jd):
        long_body = "a" * 200
        page = make_mock_page(body_text=long_body)
        result = fetch_jd._extract_body(
            page, "https://boards.greenhouse.io/x", max_chars=100
        )
        assert result == "a" * 100 + "\n\n[truncated at 100 chars]"

    def test_no_truncation_when_body_fits(self, fetch_jd):
        body = "short body"
        page = make_mock_page(body_text=body)
        result = fetch_jd._extract_body(
            page, "https://boards.greenhouse.io/x", max_chars=1000
        )
        assert result == body

    def test_none_max_chars_disables_truncation(self, fetch_jd):
        long_body = "b" * 50000
        page = make_mock_page(body_text=long_body)
        result = fetch_jd._extract_body(
            page, "https://boards.greenhouse.io/x", max_chars=None
        )
        assert result == long_body
        assert "[truncated" not in result

    # ── Exit code via subprocess ──────────────────────────────────────────────

    def test_exit_code_2_no_auth_file(self, tmp_auth_dir):
        # fetch-jd.py does NOT fail early if no auth file exists — it navigates
        # headless and exits 2 only when the page is an auth wall.
        # /feed/ is definitively auth-gated: LinkedIn always redirects it to the
        # login page for unauthenticated (headless) requests.
        # Note: this test requires network access to LinkedIn.
        env = {**os.environ, "APP_DIR": str(tmp_auth_dir)}
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS_DIR / "fetch-jd.py"),
                "https://www.linkedin.com/feed/",
            ],
            capture_output=True,
            timeout=30,
            env=env,
        )
        assert result.returncode == 2, (
            f"Expected exit 2 (auth required), got {result.returncode}.\n"
            f"stderr: {result.stderr.decode()}"
        )
