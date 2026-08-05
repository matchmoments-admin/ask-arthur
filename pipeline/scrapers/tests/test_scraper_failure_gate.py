"""Tests for the mute-aware scrape-feeds pager.

The defect these cover: `feed_sources.muted_until` was the single source of
truth for "this feed is knowingly broken, do not alarm", but only health-digest
honoured it. The GitHub Actions pager did not, so a deliberately-muted feed
(`acsc`, blocked at the cyber.gov.au edge since 2026-05-11) paged Telegram every
three hours from 2026-08-03.

Written against the SHAPES rather than specific feeds, because the dangerous
direction is over-suppression: a gate that wrongly stays silent is
indistinguishable from a healthy system. Every "cannot confirm" branch is
asserted to PAGE.
"""

from datetime import datetime, timedelta, timezone

import pytest

from check_scraper_failures import (
    partition_failures,
    read_failures,
    resolve_slug,
)

NOW = datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)
PAST = NOW - timedelta(days=1)
FUTURE = NOW + timedelta(days=24)


def _rows(**overrides):
    """Roster mirroring the real feed_sources shape after migration v264."""
    base = {
        "acsc": (True, FUTURE, "Blocked at cyber.gov.au edge; 0/1,167 successes."),
        "austrac": (False, None, "Akamai drops GitHub Actions datacenter IPs."),
        "phishing_database": (False, None, "HTTP 200 with a 1-byte body."),
        "urlhaus": (True, None, None),
        "scamwatch_alert": (True, None, None),
        "reddit": (True, None, None),
        "asic_investor": (True, None, None),
    }
    base.update(overrides)
    return base


def _fixed(mapping):
    """Resolver stub so partitioning is tested without importing real modules."""
    return lambda module_name: mapping.get(module_name)


class TestSuppression:
    def test_muted_feed_is_suppressed(self):
        pageable, suppressed = partition_failures(
            ["acsc_alerts"], _rows(), now=NOW, resolver=_fixed({"acsc_alerts": "acsc"})
        )
        assert pageable == []
        assert len(suppressed) == 1
        assert "muted until" in suppressed[0]
        # The reason travels with it — suppression hides the page, not the fact.
        assert "cyber.gov.au" in suppressed[0]

    def test_disabled_feed_is_suppressed(self):
        pageable, suppressed = partition_failures(
            ["austrac"], _rows(), now=NOW, resolver=_fixed({"austrac": "austrac"})
        )
        assert pageable == []
        assert "disabled" in suppressed[0]

    def test_unmuted_feed_pages(self):
        pageable, suppressed = partition_failures(
            ["urlhaus"], _rows(), now=NOW, resolver=_fixed({"urlhaus": "urlhaus"})
        )
        assert suppressed == []
        assert len(pageable) == 1
        assert "not muted" in pageable[0]


class TestExpiry:
    """The mute expiry is the mechanism that stops a dead feed staying dead."""

    def test_expired_mute_pages(self):
        rows = _rows(acsc=(True, PAST, "expired mute"))
        pageable, suppressed = partition_failures(
            ["acsc_alerts"], rows, now=NOW, resolver=_fixed({"acsc_alerts": "acsc"})
        )
        assert suppressed == []
        assert "EXPIRED" in pageable[0]

    def test_mute_expiring_one_second_from_now_still_suppresses(self):
        rows = _rows(acsc=(True, NOW + timedelta(seconds=1), "still muted"))
        pageable, _ = partition_failures(
            ["acsc_alerts"], rows, now=NOW, resolver=_fixed({"acsc_alerts": "acsc"})
        )
        assert pageable == []

    def test_mute_expiring_exactly_now_pages(self):
        # Boundary is strict (> now), so a mute whose instant has arrived is over.
        rows = _rows(acsc=(True, NOW, "boundary"))
        pageable, _ = partition_failures(
            ["acsc_alerts"], rows, now=NOW, resolver=_fixed({"acsc_alerts": "acsc"})
        )
        assert len(pageable) == 1


class TestFailSafe:
    """Every 'cannot confirm' branch must page. Silence must never mean unchecked."""

    def test_unresolvable_module_pages(self):
        pageable, suppressed = partition_failures(
            ["mystery_feed"], _rows(), now=NOW, resolver=_fixed({})
        )
        assert suppressed == []
        assert "UNKNOWN" in pageable[0]

    def test_slug_missing_from_roster_pages(self):
        pageable, suppressed = partition_failures(
            ["ghost"], _rows(), now=NOW, resolver=_fixed({"ghost": "not_in_roster"})
        )
        assert suppressed == []
        assert "no feed_sources row" in pageable[0]

    def test_a_muted_feed_never_masks_a_live_one(self):
        pageable, suppressed = partition_failures(
            ["acsc_alerts", "urlhaus"],
            _rows(),
            now=NOW,
            resolver=_fixed({"acsc_alerts": "acsc", "urlhaus": "urlhaus"}),
        )
        assert len(suppressed) == 1
        assert len(pageable) == 1
        assert "urlhaus" in pageable[0]


class TestSlugResolution:
    """The four module->slug mismatches, resolved from each scraper's FEED_NAME.

    These import the real modules on purpose: a hand-written map would be a
    second registry that drifts from feed_sources, which is the failure v264
    removed when it deleted the hardcoded KNOWN_DORMANT_FEEDS set.
    """

    @pytest.mark.parametrize(
        "module_name,expected",
        [
            ("acsc_alerts", "acsc"),
            ("scamwatch_alerts", "scamwatch_alert"),
            ("asic_investor_alerts", "asic_investor"),
            ("reddit_scams", "reddit"),
            ("urlhaus", "urlhaus"),
            ("abuseipdb", "abuseipdb"),
        ],
    )
    def test_module_resolves_to_its_feed_name(self, module_name, expected):
        assert resolve_slug(module_name) == expected

    def test_nonexistent_module_resolves_to_none(self):
        assert resolve_slug("definitely_not_a_scraper_module") is None


class TestReadFailures:
    def test_missing_file_means_no_failures(self, tmp_path):
        assert read_failures(str(tmp_path / "absent.txt")) == []

    def test_blank_lines_ignored_and_duplicates_collapsed(self, tmp_path):
        path = tmp_path / "f.txt"
        path.write_text("acsc_alerts\n\nacsc_alerts\nurlhaus\n")
        assert read_failures(str(path)) == ["acsc_alerts", "urlhaus"]
