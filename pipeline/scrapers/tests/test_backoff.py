"""Tests for the scraper circuit breaker (common/backoff.py).

The brake is what stops us hammering an upstream that's been blocking
GitHub Actions IPs for hours. There are two distinct trip paths to test:

  1. Threshold trip — N consecutive 'error' rows tip should_backoff to
     True, regardless of how recent or old the rows are.
  2. Cooldown skip — once we've written a 'partial:backoff_active' row,
     calls short-circuit to True while the STREAK that row belongs to is
     younger than cooldown_hours (because the partial is now sitting at
     the head of the log breaking the consecutive-error streak — without
     the cooldown path we'd resume hammering the upstream).

was_just_activated is the alert helper: True iff head row is backoff
partial AND second-row is NOT — so the Telegram alert cron pages once
per brake activation, not once per cooldown skip.

A NOTE ON HOW THESE TESTS ARE BUILT, because the previous version of this file
is a cautionary example. `test_cooldown_expires_after_24h` used to assert
release by mocking a HEAD ROW 25 hours old — but every skip writes a fresh head
row, so no cron firing more often than the cooldown could ever produce that
state. The test passed for months while the brake was permanently latched in
prod (acsc: 1,091 consecutive skips, 0 successes ever).

So: mock the state a live cron actually produces — head row one minute old — and
vary the STREAK START, which is what the decision now turns on. TestCooldownLatchRegression
below drives acsc's measured cadence (1.79h mean, 7.01h max) directly, and
reintroducing the old `streak_start = created_at` fails 7 of these tests.
"""
from datetime import datetime, timedelta, timezone

import pytest
from unittest.mock import MagicMock

from common.backoff import (
    BACKOFF_PREFIX,
    consecutive_failure_count,
    should_backoff,
    was_just_activated,
)


def _ago(**kwargs) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


def _backoff_head(minutes_ago: int = 1, count: int = 0) -> tuple:
    """The head row a live, latched cron always produces: a backoff partial
    written seconds ago, carrying a consecutive-error count of 0 because the
    partial before it already broke the error streak."""
    return (
        "partial",
        f"{BACKOFF_PREFIX} {count} consecutive failures (threshold=3)",
        _ago(minutes=minutes_ago),
    )


def _log_conn(head: tuple, streak_start: datetime | None = None, statuses=None):
    """A fake conn that routes on SQL text, so the three different queries in
    should_backoff can return three different shapes.

    The shared-single-cursor mock below cannot express this, and that mattered:
    the old cooldown tests fed the HEAD row's timestamp to every query, which is
    why they passed against a latched implementation.
    """
    statuses = statuses if statuses is not None else []

    class _Cursor:
        def __init__(self):
            self._result = None
            self._rows = []

        def execute(self, sql, params=None):
            if "min(created_at)" in sql:
                self._result = (streak_start,)
                self._rows = []
            elif "SELECT status, error_message, created_at" in sql:
                self._result = head
                self._rows = [head]
            else:
                # consecutive_failure_count / was_just_activated
                self._rows = list(statuses)
                self._result = statuses[0] if statuses else None

        def fetchone(self):
            return self._result

        def fetchall(self):
            return self._rows

        def close(self):
            pass

    conn = MagicMock()
    conn.cursor.side_effect = lambda: _Cursor()
    return conn


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

    def test_cooldown_skips_while_streak_is_young(self):
        """A backoff streak that started recently means we're cooling down —
        skip immediately, even if the threshold scan would say otherwise."""
        conn = _log_conn(
            head=_backoff_head(minutes_ago=1),
            streak_start=_ago(hours=2),  # streak began 2h ago, inside 24h
        )
        skip, _ = should_backoff(conn, "feed", threshold=3, cooldown_hours=24)
        assert skip is True

    def test_cooldown_expires_once_the_streak_is_older_than_the_window(self):
        """A streak older than cooldown_hours falls through to the threshold path.

        Note the head row here is ONE MINUTE old — the state a live cron always
        produces. The old code measured from the head and so could never reach
        this branch in production.
        """
        conn = _log_conn(
            head=_backoff_head(minutes_ago=1),
            streak_start=_ago(hours=25),  # streak began 25h ago, past 24h
        )
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


class TestCooldownLatchRegression:
    """The cooldown must be releasable by a cron that fires faster than it.

    Prod state on 2026-07-30, which every one of these asserts against: `acsc`
    had 1,091 consecutive backoff partials, 0 successes in 1,167 lifetime runs,
    mean inter-row gap 1.79h, max 7.01h — never once approaching the 24h
    cooldown, because each skip wrote a fresh head row and re-armed the window.
    `phishstats` was 243 rows into the same state.
    """

    def test_a_cron_faster_than_the_cooldown_still_releases(self):
        """THE regression test. Head row 1 minute old (a 1.8h cron just fired
        and skipped), streak 80 days old. Must release."""
        conn = _log_conn(
            head=_backoff_head(minutes_ago=1),
            streak_start=_ago(days=80),
        )
        skip, _ = should_backoff(conn, "feed", threshold=3, cooldown_hours=24)
        assert skip is False, (
            "cooldown never elapses when the cron fires faster than it — "
            "this is the acsc/phishstats latch"
        )

    @pytest.mark.parametrize("gap_hours", [0.1, 1.79, 7.01, 23.9])
    def test_release_is_independent_of_cron_frequency(self, gap_hours):
        """Whatever the cron interval, a streak older than the window releases.

        1.79h is acsc's measured mean gap and 7.01h its measured max, so these
        are not hypothetical intervals.
        """
        conn = _log_conn(
            head=_backoff_head(minutes_ago=int(gap_hours * 60)),
            streak_start=_ago(hours=30),
        )
        skip, _ = should_backoff(conn, "feed", threshold=3, cooldown_hours=24)
        assert skip is False

    def test_repeated_skips_do_not_extend_the_window(self):
        """Age is read from the streak start, so the head row's age is
        irrelevant to the decision — only the streak's age counts."""
        streak = _ago(hours=23)
        young = _log_conn(head=_backoff_head(minutes_ago=1), streak_start=streak)
        old = _log_conn(head=_backoff_head(minutes_ago=200), streak_start=streak)

        # Same streak, wildly different head ages → same verdict.
        assert should_backoff(young, "feed", cooldown_hours=24)[0] is True
        assert should_backoff(old, "feed", cooldown_hours=24)[0] is True

    def test_boundary_just_inside_the_window_still_skips(self):
        conn = _log_conn(
            head=_backoff_head(minutes_ago=1),
            streak_start=_ago(hours=23, minutes=59),
        )
        assert should_backoff(conn, "feed", cooldown_hours=24)[0] is True

    def test_a_fresh_streak_after_release_re_arms_the_window(self):
        """Once the brake re-trips, the NEW streak starts a new window —
        release is not permanent either."""
        conn = _log_conn(
            head=_backoff_head(minutes_ago=1),
            streak_start=_ago(minutes=30),  # new streak, 30 min old
        )
        assert should_backoff(conn, "feed", cooldown_hours=24)[0] is True

    def test_falls_back_to_head_row_when_streak_query_returns_nothing(self):
        """Defensive: a NULL streak start must not crash, and must not release
        a brake that just tripped."""
        conn = _log_conn(head=_backoff_head(minutes_ago=1), streak_start=None)
        assert should_backoff(conn, "feed", cooldown_hours=24)[0] is True

    def test_streak_start_query_is_actually_consulted(self):
        """Guards against a future refactor quietly reverting to the head row:
        if the streak query is not executed, this fails."""
        seen: list[str] = []

        class _Cursor:
            def execute(self, sql, params=None):
                seen.append(sql)
                self._sql = sql

            def fetchone(self):
                if "min(created_at)" in self._sql:
                    return (_ago(days=80),)
                return _backoff_head(minutes_ago=1)

            def fetchall(self):
                return []

            def close(self):
                pass

        conn = MagicMock()
        conn.cursor.side_effect = lambda: _Cursor()

        should_backoff(conn, "feed", cooldown_hours=24)
        assert any("min(created_at)" in s for s in seen), (
            "should_backoff no longer consults the streak-start query — "
            "the cooldown is measured from the head row again"
        )


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
