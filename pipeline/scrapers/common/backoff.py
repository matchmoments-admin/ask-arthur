"""Adaptive backoff for scrapers — read recent feed_ingestion_log to decide
whether to skip a scheduled run when the upstream is consistently failing.

We use status='partial' for a backoff skip (not 'error') so that the next
backoff check doesn't see the skip as a failure and self-perpetuate. The
state machine is:

  success → consecutive_errors resets to 0, normal cadence
  error   → consecutive_errors increments
  partial → does NOT count toward consecutive_errors

When consecutive_errors >= threshold, the next run skips and writes a
'partial' row with a descriptive error_message. As soon as one fetch
succeeds (or a probe verifies the upstream is healthy), the consecutive
counter naturally resets.

Why not delete the cron entry: keep the heartbeat. A 'partial' row every
3h with `consecutive_errors=N` is queryable proof that we're aware the
upstream is down, not silently dropped.
"""
from __future__ import annotations

from typing import Tuple

from .logging_config import get_logger

logger = get_logger(__name__)


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


def should_backoff(
    conn,
    feed_name: str,
    threshold: int = 5,
) -> Tuple[bool, int]:
    """Return (skip, consecutive_error_count).

    skip is True when consecutive errors >= threshold. The count is
    returned regardless so the caller can include it in the error_message
    for queryability.
    """
    count = consecutive_failure_count(conn, feed_name)
    if count >= threshold:
        logger.warning(
            f"backoff active for {feed_name}: {count} consecutive errors >= {threshold}",
            extra={"metadata": {"feed_name": feed_name, "consecutive_errors": count}},
        )
        return True, count
    return False, count
