"""Tests for the scraper circuit breaker (common/backoff.py).

The brake is what stops us hammering an upstream that's been blocking
GitHub Actions IPs for hours. There are two distinct trip paths to test:

  1. Threshold trip — N consecutive 'error' rows tip should_backoff to
     True, regardless of how recent or old the rows are.
  2. Cooldown skip — once we've written a 'partial:backoff_active' row,
     subsequent calls within cooldown_hours short-circuit to True
     without recounting the streak (because the partial is now sitting
     at the head of the log breaking the consecutive-error streak —
     without the cooldown path we'd resume hammering the upstream).

was_just_activated is the alert helper: True iff head row is backoff
partial AND second-row is NOT — so the Telegram alert cron pages once
per brake activation, not once per cooldown skip.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from common.backoff import (
    BACKOFF_PREFIX,
    consecutive_failure_count,
    should_backoff,
    was_just_activated,
)


def _make_conn(rows: list[tuple]):
    """Build a MagicMock conn whose cursor.fetchall() returns `rows`.
    rows is a list of psycopg2-style tuples — the column shape depends on
    which query is being mocked. The shared mock works for both
    consecutive_failure_count (status only), should_backoff
    (status, error_message, created_at via _most_recent_run + status via
    consecutive_failure_count), and was_just_activated (status,
    error_message)."""
    cursor = MagicMock()
    cursor.fetchall.return_value = rows
    cursor.fetchone.return_value = rows[0] if rows else None
    conn = MagicMock()
    conn.cursor.return_value = cursor
    return conn, cursor


class TestConsecutiveFailureCount:
    def test_returns_zero_when_no_rows(self):
        conn, _ = _make_conn([])
        assert consecutive_failure_count(conn, "feed") == 0

    def test_counts_consecutive_errors_at_head(self):
        conn, _ = _make_conn([("error",), ("error",), ("error",)])
        assert consecutive_failure_count(conn, "feed") == 3

    def test_stops_at_first_success(self):
        conn, _ = _make_conn([("error",), ("error",), ("success",), ("error",)])
        # First two are errors, then success breaks the streak — count is 2.
        assert consecutive_failure_count(conn, "feed") == 2

    def test_partial_breaks_streak(self):
        conn, _ = _make_conn([("error",), ("partial",), ("error",), ("error",)])
        assert consecutive_failure_count(conn, "feed") == 1


class TestShouldBackoff:
    def _make_threshold_conn(self, error_count: int):
        """Build a conn where _most_recent_run sees a non-backoff head and
        consecutive_failure_count returns `error_count`."""
        cursor = MagicMock()
        # _most_recent_run uses fetchone — return a non-backoff row.
        cursor.fetchone.return_value = (
            "success",
            None,
            datetime.now(timezone.utc) - timedelta(hours=1),
        )
        # consecutive_failure_count uses fetchall — return N error rows.
        cursor.fetchall.return_value = [("error",)] * error_count
        conn = MagicMock()
        conn.cursor.return_value = cursor
        return conn

    def test_returns_false_below_threshold(self):
        conn = self._make_threshold_conn(error_count=2)
        skip, count = should_backoff(conn, "feed", threshold=3)
        assert skip is False
        assert count == 2

    def test_threshold_trips_when_no_recent_partial(self):
        conn = self._make_threshold_conn(error_count=3)
        skip, count = should_backoff(conn, "feed", threshold=3)
        assert skip is True
        assert count == 3

    def test_cooldown_skips_within_24h(self):
        """A fresh backoff partial at the head means we're cooling down —
        skip immediately, even if the threshold scan would say otherwise."""
        cursor = MagicMock()
        cursor.fetchone.return_value = (
            "partial",
            f"{BACKOFF_PREFIX} 5 consecutive failures",
            datetime.now(timezone.utc) - timedelta(hours=2),  # 2h into 24h window
        )
        # If we were to re-count, the head 'partial' would break the streak
        # at 0 — but the cooldown path should fire first.
        cursor.fetchall.return_value = []
        conn = MagicMock()
        conn.cursor.return_value = cursor

        skip, _ = should_backoff(conn, "feed", threshold=3, cooldown_hours=24)
        assert skip is True

    def test_cooldown_expires_after_24h(self):
        """A backoff partial older than cooldown_hours falls through to the
        threshold path."""
        cursor = MagicMock()
        cursor.fetchone.return_value = (
            "partial",
            f"{BACKOFF_PREFIX} 5 consecutive failures",
            datetime.now(timezone.utc) - timedelta(hours=25),  # past 24h
        )
        # No errors after the partial → threshold returns 0 → skip is False.
        cursor.fetchall.return_value = []
        conn = MagicMock()
        conn.cursor.return_value = cursor

        skip, _ = should_backoff(conn, "feed", threshold=3, cooldown_hours=24)
        assert skip is False

    def test_non_backoff_partial_does_not_trigger_cooldown(self):
        """A 'partial' row that ISN'T a backoff_active partial (e.g. a
        no-op refresh) shouldn't trigger the cooldown skip."""
        cursor = MagicMock()
        cursor.fetchone.return_value = (
            "partial",
            "every row hashed-equal — no-op refresh",  # not a backoff message
            datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        # Threshold scan sees no errors at the head (partial breaks streak).
        cursor.fetchall.return_value = []
        conn = MagicMock()
        conn.cursor.return_value = cursor

        skip, _ = should_backoff(conn, "feed", threshold=3, cooldown_hours=24)
        assert skip is False


class TestWasJustActivated:
    def test_false_when_no_rows(self):
        conn, _ = _make_conn([])
        assert was_just_activated(conn, "feed") is False

    def test_false_when_head_is_not_backoff(self):
        conn, _ = _make_conn([("success", None), ("partial", f"{BACKOFF_PREFIX} 3")])
        assert was_just_activated(conn, "feed") is False

    def test_true_on_transition(self):
        """Head is backoff partial, prior row is something else — fresh
        activation."""
        conn, _ = _make_conn(
            [
                ("partial", f"{BACKOFF_PREFIX} 3 consecutive failures"),
                ("error", "HTTP 403"),
            ]
        )
        assert was_just_activated(conn, "feed") is True

    def test_false_during_cooldown(self):
        """Head AND prior row are both backoff partials — operator was
        already paged on the activation; skip silently."""
        conn, _ = _make_conn(
            [
                ("partial", f"{BACKOFF_PREFIX} 3 consecutive failures"),
                ("partial", f"{BACKOFF_PREFIX} 3 consecutive failures"),
            ]
        )
        assert was_just_activated(conn, "feed") is False

    def test_true_when_only_one_row_and_it_is_backoff(self):
        """Edge case: a brand-new feed whose first run was a backoff (this
        shouldn't happen in normal flow, but treat it as activation since
        there's no prior brake state to suppress on)."""
        conn, _ = _make_conn([("partial", f"{BACKOFF_PREFIX} 3 consecutive failures")])
        assert was_just_activated(conn, "feed") is True
