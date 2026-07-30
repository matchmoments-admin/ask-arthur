"""Post-run gate — exit non-zero if any vulnerability feed failed this run.

WHY THIS EXISTS. Every scraper in this package catches its own exceptions,
writes ``status='error'`` to ``vulnerability_ingestion_log``, and returns
normally — so the process exits 0. The workflow's ``notify-failure`` job is
gated on ``failure()``, which therefore could never fire. Measured 2026-07-30:
the workflow was 16/16 ``success`` while ``nvd_recent``, ``github_advisory``
and ``cert_au_vulns`` had each failed 15 of 15 runs since 2026-04-21 — a 100%
failure rate for their entire existence, reported as green for 14 weeks.

This mirrors the ``scraper_failures.txt`` gate in ``scrape-feeds.yml``, but
reads the log table instead of a file, because here the failure is swallowed
before it ever reaches the shell.

Two distinct failure shapes are both caught, deliberately:

1. A feed that logged ``status <> 'success'``.
2. A feed that logged **nothing at all** — the process died before
   ``log_ingestion()``, or the step was skipped by a gate nobody noticed. This
   is the shape that hides best: a feed which stops writing entirely drops out
   of every query that groups by what is present. Pass ``--expect`` so absence
   is an error rather than an empty row.

Usage::

    python -m vulnerabilities.check_run --since "$RUN_START" \\
        --expect cisa_kev,nvd_recent,github_advisory,osv_feed,cert_au_vulns

Exits 0 when every expected feed logged exactly ``success``; 1 otherwise, with
a ``::error::`` annotation per offending feed so it surfaces in the Actions UI.
"""

from __future__ import annotations

import argparse
import sys

from common.db import get_db
from common.logging_config import get_logger

logger = get_logger(__name__)


def _annotate(message: str) -> None:
    """Emit a GitHub Actions error annotation (harmless noise when run locally)."""
    print(f"::error::{message}")


def evaluate_rows(
    rows: list[tuple[str, str, int, int, str | None]],
    expect: list[str],
) -> list[str]:
    """Pure verdict over log rows. Returns one message per offending feed.

    Kept free of DB access so the two failure shapes can be tested directly —
    the shapes are the whole point of this module, so they need coverage that
    does not depend on a live Postgres.
    """
    seen: dict[str, tuple[str, int, int, str | None]] = {}
    for feed_name, status, fetched, new, error_message in rows:
        # Keep the WORST status per feed — a retry that succeeds after an error
        # must not paper over the error.
        prior = seen.get(feed_name)
        if prior is None or (prior[0] == "success" and status != "success"):
            seen[feed_name] = (status, fetched, new, error_message)

    problems: list[str] = []

    for feed in expect:
        entry = seen.get(feed)
        if entry is None:
            problems.append(
                f"{feed}: logged NOTHING this run — the scraper died before "
                f"log_ingestion(), or its step did not execute"
            )
            continue

        status, fetched, new, error_message = entry
        if status != "success":
            detail = (error_message or "no error_message recorded").splitlines()[0]
            problems.append(f"{feed}: status={status} — {detail[:400]}")
        else:
            logger.info("%s: ok (fetched=%s new=%s)", feed, fetched, new)

    unexpected = sorted(set(seen) - set(expect))
    if unexpected:
        # Not a failure — a feed logging outside the expected set is worth
        # seeing, but it does not mean this run is broken.
        logger.info("feeds logged but not in --expect: %s", ", ".join(unexpected))

    return problems


def check_run(since: str, expect: list[str]) -> int:
    """Return the number of feeds that failed or went missing since ``since``."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT feed_name,
                   status,
                   records_fetched,
                   records_new,
                   error_message
              FROM vulnerability_ingestion_log
             WHERE run_at >= %s::timestamptz
             ORDER BY run_at
            """,
            (since,),
        )
        rows = cursor.fetchall()
        cursor.close()

    problems = evaluate_rows(rows, expect)
    for message in problems:
        _annotate(message)
    return len(problems)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--since",
        required=True,
        help="ISO-8601 timestamp; only rows with run_at >= this are considered",
    )
    parser.add_argument(
        "--expect",
        required=True,
        help="comma-separated feed_name values that must each log success",
    )
    args = parser.parse_args()

    expect = [f.strip() for f in args.expect.split(",") if f.strip()]
    if not expect:
        print("::error::--expect resolved to an empty list; nothing was checked")
        return 1

    problems = check_run(args.since, expect)

    if problems:
        print(
            f"::error::{problems} of {len(expect)} vulnerability feeds failed or "
            f"went missing this run"
        )
        return 1

    print(f"All {len(expect)} vulnerability feeds logged success.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
