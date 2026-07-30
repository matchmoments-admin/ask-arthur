"""Tests for the vulnerability post-run gate and the GHSA ecosystem filter.

Both cover defects that were live in prod for 14 weeks while the workflow
reported success on every run (measured 2026-07-30), so the tests are written
against the two *shapes* of silent failure rather than against specific feeds:

  1. a feed that logs a non-success status but exits 0
  2. a feed that logs nothing at all

The GHSA tests pin the ecosystem filter that moved from the GraphQL query
(where the argument was rejected outright) to the client.
"""

import pytest

from vulnerabilities.check_run import evaluate_rows
from vulnerabilities.github_advisory import (
    ECOSYSTEMS,
    _advisory_ecosystems,
    _primary_ecosystem,
)

EXPECT = ["cisa_kev", "nvd_recent", "github_advisory", "osv_feed"]


def _row(feed, status="success", fetched=10, new=5, err=None):
    return (feed, status, fetched, new, err)


class TestEvaluateRows:
    def test_all_success_is_clean(self):
        rows = [_row(f) for f in EXPECT]
        assert evaluate_rows(rows, EXPECT) == []

    def test_error_status_is_reported(self):
        """Shape 1 — the scraper caught its own exception and exited 0."""
        rows = [_row(f) for f in EXPECT if f != "nvd_recent"]
        rows.append(_row("nvd_recent", status="error", fetched=0, new=0, err="404 Client Error"))

        problems = evaluate_rows(rows, EXPECT)

        assert len(problems) == 1
        assert "nvd_recent" in problems[0]
        assert "status=error" in problems[0]
        assert "404 Client Error" in problems[0]

    def test_missing_feed_is_reported(self):
        """Shape 2 — the feed logged nothing, so it is absent from the rows.

        This is the shape that hides best: a feed which stops writing entirely
        drops out of any query that groups by what is present.
        """
        rows = [_row(f) for f in EXPECT if f != "github_advisory"]

        problems = evaluate_rows(rows, EXPECT)

        assert len(problems) == 1
        assert "github_advisory" in problems[0]
        assert "NOTHING" in problems[0]

    def test_every_feed_missing_reports_every_feed(self):
        problems = evaluate_rows([], EXPECT)
        assert len(problems) == len(EXPECT)

    def test_worst_status_wins_over_a_later_success(self):
        """An error followed by a success in the same run must still fail."""
        rows = [_row(f) for f in EXPECT]
        rows.append(_row("osv_feed", status="error", err="transient"))

        problems = evaluate_rows(rows, EXPECT)

        assert len(problems) == 1
        assert "osv_feed" in problems[0]

    def test_skipped_is_not_success(self):
        """`skipped` means the control did not run, which is not a pass."""
        rows = [_row(f) for f in EXPECT if f != "github_advisory"]
        rows.append(_row("github_advisory", status="skipped", err="GHSA_PAT not configured"))

        problems = evaluate_rows(rows, EXPECT)

        assert len(problems) == 1
        assert "status=skipped" in problems[0]

    def test_unexpected_feed_does_not_fail_the_run(self):
        rows = [_row(f) for f in EXPECT] + [_row("cert_au_vulns", status="error", err="timeout")]
        assert evaluate_rows(rows, EXPECT) == []

    def test_missing_error_message_still_reports(self):
        rows = [_row(f) for f in EXPECT if f != "osv_feed"]
        rows.append(_row("osv_feed", status="error", err=None))

        problems = evaluate_rows(rows, EXPECT)

        assert len(problems) == 1
        assert "no error_message recorded" in problems[0]

    def test_multiline_error_is_collapsed_to_one_line(self):
        rows = [_row(f) for f in EXPECT if f != "nvd_recent"]
        rows.append(_row("nvd_recent", status="error", err="first line\nsecond line"))

        problems = evaluate_rows(rows, EXPECT)

        assert "first line" in problems[0]
        assert "second line" not in problems[0]


def _advisory(*ecosystems):
    return {
        "vulnerabilities": {
            "nodes": [{"package": {"name": "pkg", "ecosystem": e}} for e in ecosystems]
        }
    }


class TestGhsaEcosystemFilter:
    @pytest.mark.parametrize("eco", ECOSYSTEMS)
    def test_target_ecosystem_is_kept(self, eco):
        assert _primary_ecosystem(_advisory(eco)) == eco

    def test_non_target_ecosystem_is_dropped(self):
        """The API no longer filters server-side, so this is the only filter."""
        assert _primary_ecosystem(_advisory("RUBYGEMS")) is None
        assert _primary_ecosystem(_advisory("COMPOSER", "NUGET")) is None

    def test_ecosystems_order_is_the_tie_break(self):
        assert _primary_ecosystem(_advisory("GO", "NPM")) == "NPM"
        assert _primary_ecosystem(_advisory("MAVEN", "PIP")) == "PIP"

    def test_mixed_advisory_keeps_the_target_ecosystem(self):
        assert _primary_ecosystem(_advisory("RUBYGEMS", "MAVEN")) == "MAVEN"

    def test_lowercase_api_value_is_normalised(self):
        assert _primary_ecosystem(_advisory("npm")) == "NPM"

    def test_advisory_with_no_packages_is_dropped(self):
        assert _primary_ecosystem({"vulnerabilities": {"nodes": []}}) is None
        assert _primary_ecosystem({}) is None

    def test_malformed_package_entries_do_not_raise(self):
        node = {"vulnerabilities": {"nodes": [{"package": None}, {}, {"package": {}}]}}
        assert _advisory_ecosystems(node) == []
        assert _primary_ecosystem(node) is None

    def test_advisory_ecosystems_dedupes_and_sorts(self):
        assert _advisory_ecosystems(_advisory("NPM", "NPM", "GO")) == ["GO", "NPM"]
