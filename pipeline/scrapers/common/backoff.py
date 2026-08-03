"""Adaptive backoff for scrapers — read recent feed_ingestion_log to decide
whether to skip a scheduled run when the upstream is consistently failing.

We use status='partial' for a backoff skip (not 'error') so that
consecutive_failure_count doesn't see the skip as a failure. The state
machine is:

  success → consecutive_errors resets to 0, normal cadence
  error   → consecutive_errors increments
  partial → does NOT count toward consecutive_errors

When consecutive_errors >= threshold, the next run writes a
'partial:backoff_active:...' row and exits cleanly. While the CURRENT BACKOFF
STREAK started less than `cooldown_hours` ago (default 24h), should_backoff()
returns True immediately without re-counting — that's the actual circuit
breaker, distinct from the threshold trip. Once the streak is older than the
cooldown, calls fall through and probe upstream again.

Without the cooldown, the partial that lives at the head of the log
would break the consecutive-error streak on the next call (count=0),
and we'd resume hammering the upstream — that's a speed bump, not a
brake. The cooldown is what makes it a real circuit breaker.

Why not delete the cron entry: keep the heartbeat. A 'partial' row
every cron firing with `backoff_active:N` is queryable proof that we
are deliberately not running, not silently dropped.

THE LATCH BUG — fixed 2026-07-30. Read this before touching the cooldown.

The cooldown used to be measured from the MOST RECENT log row. But
enforce_backoff_or_skip() writes a NEW 'backoff_active' partial every time it
skips, so the head row was always seconds old and the window was re-armed by
the very act of skipping. Release required `cooldown_hours` of total workflow
silence, which a cron firing more often than the cooldown makes impossible.

The result was a permanent latch, in prod, for months. Measured 2026-07-30:
`acsc` had logged 1,091 consecutive backoff partials with ZERO successes across
its entire 1,167-row history, inter-row gaps averaging 1.79h against a 24h
cooldown that therefore never once elapsed. `phishstats` was in the same state,
243 rows deep. The recorded message on every one of them was the tell —
`backoff_active: 0 consecutive failures (threshold=3); skipping for cooldown` —
zero failures, and still skipping. AUSTRAC was de-scheduled for this same root
cause on 2026-06-29 without the general case being recognised.

Note that the unit test `test_cooldown_expires_after_24h` PASSED throughout,
because it mocked a 25h-old head row — a state the old code could not produce
once a cron was firing faster than the cooldown. A test that fabricates an
unreachable state proves nothing about the loop, which is why the regression
tests now drive the streak-start query rather than the head row.

The cooldown is now measured from the OLDEST contiguous 'backoff_active' row at
the head of the log (see _backoff_streak_start), so repeated skips cannot extend
it. One consequence worth knowing: after the cooldown expires the brake allows
up to `threshold` probe attempts before re-tripping, because release drops back
into the ordinary consecutive-error count. That is deliberate — a few requests
per cooldown window is the price of ever noticing the upstream came back.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Tuple

from .db import get_db, log_ingestion
from .logging_config import get_logger

logger = get_logger(__name__)

BACKOFF_PREFIX = "backoff_active:"


def consecutive_failure_count(conn, feed_name: str, lookback: int = 10) -> int:
    """Count consecutive 'error' rows from the most recent run backwards.

    Stops counting at the first non-'error' row. lookback caps the SQL
    scan so it never reads the entire history; a default of 10 means we
    can detect a 5-failure backoff threshold with margin.
    """
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT status FROM public.feed_ingestion_log
            WHERE feed_name = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (feed_name, lookback),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()

    count = 0
    for (status,) in rows:
        if status == "error":
            count += 1
        else:
            # A 'success' or 'partial' row breaks the streak.
            break
    return count


def _most_recent_run(conn, feed_name: str) -> Tuple[str | None, str | None, datetime | None]:
    """Return (status, error_message, created_at) of the most recent log row,
    or (None, None, None) if the feed has never run."""
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT status, error_message, created_at FROM public.feed_ingestion_log
            WHERE feed_name = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (feed_name,),
        )
        row = cursor.fetchone()
    finally:
        cursor.close()
    if row is None:
        return None, None, None
    return row[0], row[1], row[2]


def _backoff_streak_start(conn, feed_name: str) -> datetime | None:
    """created_at of the OLDEST contiguous 'backoff_active' row at the head.

    This is the anchor the cooldown is measured from. Measuring from the head
    row instead is the latch bug in the module docstring: every skip writes a
    new head, so the window never elapses.

    Implemented as two indexed aggregates rather than by walking the streak,
    because a latched feed's streak runs to a thousand rows: find the most
    recent row that is NOT a backoff partial, then take the oldest row after it.
    Everything after that boundary is a backoff partial by construction.

    Returns None when the feed has no rows, or when nothing at the head is a
    backoff partial — in which case there is no streak to anchor.
    """
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT min(created_at)
              FROM public.feed_ingestion_log
             WHERE feed_name = %s
               AND created_at > COALESCE((
                     SELECT max(created_at)
                       FROM public.feed_ingestion_log
                      WHERE feed_name = %s
                        AND NOT (status = 'partial'
                                 AND error_message LIKE %s)
                   ), '-infinity'::timestamptz)
            """,
            (feed_name, feed_name, BACKOFF_PREFIX + "%"),
        )
        row = cursor.fetchone()
    finally:
        cursor.close()
    return row[0] if row else None


def should_backoff(
    conn,
    feed_name: str,
    threshold: int = 3,
    cooldown_hours: int = 24,
) -> Tuple[bool, int]:
    """Return (skip, consecutive_error_count).

    skip is True when EITHER:
      - the head row is a 'partial:backoff_active' AND the streak it belongs to
        started less than cooldown_hours ago (still cooling down), OR
      - consecutive errors >= threshold (fresh trip).

    The count is returned regardless so the caller can include it in the
    error_message for queryability.
    """
    status, error_message, created_at = _most_recent_run(conn, feed_name)

    # Cooldown path — the head row is a backoff skip. Measure the window from
    # the START of the current streak, NOT from this row: see the latch bug in
    # the module docstring.
    if (
        status == "partial"
        and error_message is not None
        and error_message.startswith(BACKOFF_PREFIX)
        and created_at is not None
    ):
        # Fall back to the head row only if the streak query returns nothing,
        # which should not happen when the head IS a backoff partial. Note the
        # fallback reproduces the old latch, so prefer the streak start
        # whenever it is available.
        streak_start = _backoff_streak_start(conn, feed_name) or created_at

        # Postgres returns timezone-aware datetimes for TIMESTAMPTZ columns.
        # Compare in UTC to avoid TZ confusion.
        age = datetime.now(timezone.utc) - streak_start
        if age < timedelta(hours=cooldown_hours):
            # Surface the original consecutive-error count so the caller
            # can echo it back into the new partial row's error_message.
            count = consecutive_failure_count(conn, feed_name, lookback=20)
            logger.info(
                f"backoff cooldown active for {feed_name}: "
                f"{int(age.total_seconds() // 60)} min into "
                f"{cooldown_hours}h window",
                extra={
                    "metadata": {
                        "feed_name": feed_name,
                        "consecutive_errors": count,
                        "cooldown_remaining_min": int(
                            (timedelta(hours=cooldown_hours) - age).total_seconds() // 60
                        ),
                    }
                },
            )
            return True, count

        # Cooldown has elapsed. Fall through and let the upstream be probed.
        # Logged at warning so it always ships (INFO is 10%-sampled), because
        # "the brake released" is the event whose absence hid the latch for
        # months — with no release log there was nothing to notice missing.
        logger.warning(
            f"backoff cooldown EXPIRED for {feed_name} after "
            f"{int(age.total_seconds() // 3600)}h — probing upstream",
            extra={
                "metadata": {
                    "feed_name": feed_name,
                    "streak_started_at": streak_start.isoformat(),
                    "streak_age_hours": int(age.total_seconds() // 3600),
                    "cooldown_hours": cooldown_hours,
                }
            },
        )

    # Threshold path — count consecutive errors back from the head and
    # trip if we've crossed the limit.
    count = consecutive_failure_count(conn, feed_name)
    if count >= threshold:
        logger.warning(
            f"backoff active for {feed_name}: {count} consecutive errors >= {threshold}",
            extra={"metadata": {"feed_name": feed_name, "consecutive_errors": count}},
        )
        return True, count
    return False, count


def enforce_backoff_or_skip(
    feed_name: str,
    threshold: int = 3,
    record_type: str = "url",
    cooldown_hours: int = 24,
) -> bool:
    """Single-line brake gate for scraper entry points.

    Opens its own short-lived DB connection. If the brake is active, writes
    a 'partial:backoff_active:...' row to feed_ingestion_log and returns
    True. Caller should `return` immediately after a True. Returns False if
    the scraper should run normally.

    Usage at the top of a scraper's scrape():

        from common.backoff import enforce_backoff_or_skip

        def scrape() -> None:
            if enforce_backoff_or_skip(FEED_NAME, threshold=3, record_type="url"):
                return
            # ... existing scrape work ...

    The early-return path performs exactly one SELECT (LIMIT 10 on indexed
    columns) and at most one INSERT — both bounded and fast. Safe to add
    even on hot scraper paths.
    """
    start = time.time()
    with get_db() as conn:
        skip, error_count = should_backoff(
            conn, feed_name, threshold=threshold, cooldown_hours=cooldown_hours
        )
        if not skip:
            return False

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=feed_name,
            status="partial",
            records_fetched=0,
            duration_ms=duration_ms,
            error_message=(
                f"{BACKOFF_PREFIX} {error_count} consecutive failures "
                f"(threshold={threshold}); skipping for cooldown. "
                f"Manual probe: gh workflow run scrape-feeds.yml -f feed={feed_name}"
            ),
            record_type=record_type,
        )
        logger.warning(
            f"{feed_name} skipped: backoff active "
            f"({error_count} consecutive errors, threshold={threshold})"
        )
        return True


def was_just_activated(conn, feed_name: str) -> bool:
    """Return True if the most-recent row is a backoff_active partial AND
    the row immediately before it is NOT — i.e. we just transitioned from
    'running' to 'circuit-breaker-on'. Used by the alerting cron to page
    operator only on transitions, not on every cooldown skip."""
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT status, error_message FROM public.feed_ingestion_log
            WHERE feed_name = %s
            ORDER BY created_at DESC
            LIMIT 2
            """,
            (feed_name,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()

    if len(rows) < 1:
        return False

    head_status, head_msg = rows[0]
    head_is_backoff = (
        head_status == "partial"
        and head_msg is not None
        and head_msg.startswith(BACKOFF_PREFIX)
    )
    if not head_is_backoff:
        return False

    if len(rows) < 2:
        # First-ever run was a backoff (shouldn't normally happen, but
        # treat as activation since there's no prior brake state).
        return True

    prev_status, prev_msg = rows[1]
    prev_is_backoff = (
        prev_status == "partial"
        and prev_msg is not None
        and prev_msg.startswith(BACKOFF_PREFIX)
    )
    return not prev_is_backoff
