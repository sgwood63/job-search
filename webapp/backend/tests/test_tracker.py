from pathlib import Path
import pytest
from tracker import slugify, parse_table, match_folder, parse_tracker


# ---------------------------------------------------------------------------
# slugify
# ---------------------------------------------------------------------------

def test_slugify_basic():
    assert slugify("Hello World!") == "hello-world"


def test_slugify_all_caps():
    assert slugify("ACME CORP") == "acme-corp"


def test_slugify_special_chars():
    # Multiple consecutive specials collapse to one hyphen
    assert slugify("foo--bar") == "foo-bar"


def test_slugify_leading_trailing_stripped():
    assert slugify("  --Foo--  ") == "foo"


def test_slugify_numbers_kept():
    assert slugify("V8 Engine") == "v8-engine"


# ---------------------------------------------------------------------------
# parse_table
# ---------------------------------------------------------------------------

def test_parse_table_empty():
    headers, rows = parse_table([])
    assert headers == []
    assert rows == []


def test_parse_table_basic():
    lines = [
        "| Company | Role | Status |",
        "|---------|------|--------|",
        "| Acme    | SWE  | Active |",
    ]
    headers, rows = parse_table(lines)
    assert headers == ["company", "role", "status"]
    assert rows == [{"company": "Acme", "role": "SWE", "status": "Active"}]


def test_parse_table_multiple_rows():
    lines = [
        "| A | B |",
        "|---|---|",
        "| 1 | 2 |",
        "| 3 | 4 |",
    ]
    _, rows = parse_table(lines)
    assert len(rows) == 2
    assert rows[1] == {"a": "3", "b": "4"}


def test_parse_table_short_row_padded():
    lines = [
        "| A | B | C |",
        "|---|---|---|",
        "| x | y |",   # Missing third column
    ]
    _, rows = parse_table(lines)
    assert rows[0]["c"] == ""


def test_parse_table_stops_at_blank_line():
    lines = [
        "| A | B |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "| 3 | 4 |",  # Should be ignored — outside table
    ]
    _, rows = parse_table(lines)
    assert len(rows) == 1


def test_parse_table_headers_lowercased_underscored():
    lines = [
        "| Next Action | Status Detail |",
        "|-------------|---------------|",
        "| Follow up   | Waiting       |",
    ]
    headers, rows = parse_table(lines)
    assert "next_action" in headers
    assert "status_detail" in headers
    assert rows[0]["next_action"] == "Follow up"


# ---------------------------------------------------------------------------
# match_folder
# ---------------------------------------------------------------------------

def test_match_folder_missing_dir(tmp_path):
    result = match_folder("2026-01-15", "Acme", "Software Engineer", tmp_path / "nonexistent")
    assert result is None


def test_match_folder_empty_dir(tmp_path):
    apps = tmp_path / "applications"
    apps.mkdir()
    result = match_folder("2026-01-15", "Acme", "Software Engineer", apps)
    assert result is None


def test_match_folder_exact_date_and_company(tmp_path):
    apps = tmp_path / "applications"
    apps.mkdir()
    folder = apps / "2026-01-15-acme-software-engineer"
    folder.mkdir()
    result = match_folder("2026-01-15", "Acme", "Software Engineer", apps)
    assert result == "2026-01-15-acme-software-engineer"


def test_match_folder_agency_suffix_stripped(tmp_path):
    apps = tmp_path / "applications"
    apps.mkdir()
    folder = apps / "2026-03-01-widgets-inc-sales-engineer"
    folder.mkdir()
    # Agency suffix "(via Jobot)" should be stripped before matching
    result = match_folder("2026-03-01", "Widgets Inc (via Jobot)", "Sales Engineer", apps)
    assert result == "2026-03-01-widgets-inc-sales-engineer"


def test_match_folder_below_threshold_returns_none(tmp_path):
    apps = tmp_path / "applications"
    apps.mkdir()
    (apps / "2026-06-01-completely-different-company-role").mkdir()
    result = match_folder("2025-01-01", "XYZ Corp", "Designer", apps)
    assert result is None


def test_match_folder_multiple_candidates_picks_best(tmp_path):
    apps = tmp_path / "applications"
    apps.mkdir()
    (apps / "2026-05-01-wrong-company-wrong-role").mkdir()
    (apps / "2026-05-10-right-corp-solutions-engineer").mkdir()
    result = match_folder("2026-05-10", "Right Corp", "Solutions Engineer", apps)
    assert result == "2026-05-10-right-corp-solutions-engineer"


# ---------------------------------------------------------------------------
# parse_tracker
# ---------------------------------------------------------------------------

SAMPLE_TRACKER = """
## Active Applications

| Date | Company | Role | Profile | Source | Status | Status Detail | Next Action | Priority |
|------|---------|------|---------|--------|--------|---------------|-------------|----------|
| 2026-05-01 | Acme | Solutions Engineer | presales-se | LinkedIn | Applied | | Follow up 2026-05-15 | ⭐️⭐️⭐️ |

## Closed / Rejected

| Date | Company | Role | Profile | Status Detail | Notes |
|------|---------|------|---------|---------------|-------|
| 2026-04-01 | OldCo | SDR | sales | No response | |
"""


def test_parse_tracker_returns_structure(tmp_path):
    result = parse_tracker(SAMPLE_TRACKER, tmp_path)
    assert "active" in result
    assert "phase_d" in result
    assert "closed" in result


def test_parse_tracker_active_row(tmp_path):
    result = parse_tracker(SAMPLE_TRACKER, tmp_path)
    assert len(result["active"]) == 1
    row = result["active"][0]
    assert row["company"] == "Acme"
    assert row["role"] == "Solutions Engineer"
    assert row["date"] == "2026-05-01"


def test_parse_tracker_closed_row(tmp_path):
    result = parse_tracker(SAMPLE_TRACKER, tmp_path)
    assert len(result["closed"]) == 1
    row = result["closed"][0]
    assert row["company"] == "OldCo"
    assert row["status"] == "Closed"


def test_parse_tracker_empty_content(tmp_path):
    result = parse_tracker("", tmp_path)
    assert result == {"active": [], "phase_d": [], "closed": []}


def test_parse_tracker_no_sections(tmp_path):
    result = parse_tracker("# Job Search Tracker\n\nSome intro text.", tmp_path)
    assert result["active"] == []
    assert result["closed"] == []
