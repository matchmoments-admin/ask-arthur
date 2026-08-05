"""Post-run gate for scrape-feeds — page only for feeds that are NOT muted.

WHY THIS EXISTS. Three individually-correct changes combined into a pager that
cries wolf every three hours:

  * PR #879 added the ``Fail if any scraper errored`` gate. Before it a scraper
    that exited non-zero was swallowed by ``|| echo … >> scraper_failures.txt``
    and the job still passed, so ``notify-failure`` could never fire. The gate
    is right — it is the reason the failure below is visible at all.
  * PR #880 un-latched the backoff circuit breaker, so ``acsc_alerts`` now
    genuinely ATTEMPTS the fetch on every run instead of skipping it.
  * migration v264 muted ``acsc`` with an EXPIRY (2026-08-29) rather than
    hiding it, so the feed re-enters alarms instead of staying quietly dead.

The gap none of them closed: ``feed_sources.muted_until`` is the single source
of truth for "this feed is knowingly broken, do not alarm", and only
``health-digest`` honoured it. The GitHub Actions pager had no idea it existed,
so muting a feed silenced one alerting path and not the other. Result: ~8
Telegram pages/day for ``acsc``, a feed proven blocked at the cyber.gov.au edge
since 2026-05-11 (0 successes in 1,167 runs) and deliberately muted.

An alert that fires 8x/day for a known problem stops being read — including on
the day it names a DIFFERENT feed. That is the same alert-fatigue failure this
whole audit exists to prevent, arriving from the opposite direction.

THE FAIL-SAFE RULE. Suppression requires a POSITIVE, CONFIRMED match to a
``feed_sources`` row that is ``enabled = false`` or ``muted_until > now()``.
Everything else pages:

    module will not import           -> page
    module has no FEED_NAME          -> page
    slug not present in feed_sources -> page
    DB unreachable / query failed    -> page (every failure, and say why)

Backwards, this becomes a gate whose silence means "not checked" rather than
"nothing wrong" — the same shape as a ``skipped`` GitHub conclusion rendering
as a pass, which is how 86 missing DR backups went unnoticed.

WHY IT RESOLVES SLUGS BY IMPORT. The workflow writes MODULE names
(``acsc_alerts``) but ``feed_sources.slug`` holds feed names (``acsc``). Four of
the eighteen differ: acsc_alerts->acsc, scamwatch_alerts->scamwatch_alert,
asic_investor_alerts->asic_investor, reddit_scams->reddit. A hand-written map
here would be a SECOND registry that drifts from the first — precisely what
v264 deleted when it removed the hardcoded ``KNOWN_DORMANT_FEEDS`` set that had
been hiding 7 actively-producing feeds for months. Each scraper already declares
a module-level ``FEED_NAME``, and that constant IS the slug it writes to
``feed_ingestion_log``. Read it; never re-declare it.

Usage::

    python -m check_scraper_failures --file "$GITHUB_WORKSPACE/scraper_failures.txt"

Exits 0 when the failure list is empty or every entry resolved to a muted or
disabled feed; 1 otherwise, with a ``::error::`` annotation per pageable feed.
"""

from __future__ import annotations

import argparse
import importlib
import os
import re
import sys
from datetime import datetime, timezone

from common.db import get_db
from common.logging_config import get_logger

logger = get_logger(__name__)

# Rows are (enabled, muted_until, muted_reason) keyed by slug.
FeedRow = tuple[bool, datetime | None, str | None]


def _annotate(message: str) -> None:
    """Emit a GitHub Actions error annotation (harmless noise when run locally)."""
    print(f"::error::{message}")


def resolve_slug(module_name: str) -> str | None:
    """Map a scraper MODULE name to its feed_sources slug via its FEED_NAME.

    Returns None if the module cannot be imported or does not declare a
    non-empty string FEED_NAME. None means "cannot confirm" and the caller MUST
    treat it as pageable — never as suppressible.
    """
    try:
        module = importlib.import_module(module_name)
    except Exception as exc:  # noqa: BLE001 — any import failure means "cannot confirm"
        logger.warning("could not import scraper module %r: %s", module_name, exc)
        return None

    slug = getattr(module, "FEED_NAME", None)
    if not isinstance(slug, str) or not slug.strip():
        logger.warning("module %r declares no usable FEED_NAME", module_name)
        return None
    return slug.strip()


def partition_failures(
    failed: list[str],
    feed_rows: dict[str, FeedRow],
    *,
    now: datetime | None = None,
    resolver=resolve_slug,
) -> tuple[list[str], list[str]]:
    """Split failed scraper modules into (pageable, suppressed).

    Pure apart from the injected ``resolver`` — no DB, no clock — so the
    fail-safe branches can be tested directly. The shapes ARE the point of this
    module, so they need coverage that does not depend on a live Postgres.

    ``suppressed`` entries are formatted with their reason so the run log still
    records that the feed failed; suppression hides the PAGE, not the fact.
    """
    moment = now or datetime.now(timezone.utc)
    pageable: list[str] = []
    suppressed: list[str] = []

    for module_name in failed:
        slug = resolver(module_name)
        if slug is None:
            pageable.append(
                f"{module_name}: could not resolve a feed_sources slug "
                f"(module missing or no FEED_NAME) — paging because mute "
                f"status is UNKNOWN, not because it is known-live"
            )
            continue

        row = feed_rows.get(slug)
        if row is None:
            pageable.append(
                f"{module_name} (slug {slug}): no feed_sources row — paging "
                f"because mute status is UNKNOWN. Add the feed to the roster."
            )
            continue

        enabled, muted_until, muted_reason = row
        reason = (muted_reason or "no reason recorded").splitlines()[0][:200]

        if not enabled:
            suppressed.append(f"{module_name} (slug {slug}): disabled — {reason}")
            continue

        if muted_until is not None and muted_until > moment:
            suppressed.append(
                f"{module_name} (slug {slug}): muted until "
                f"{muted_until.isoformat()} — {reason}"
            )
            continue

        # Enabled and either never muted or the mute has EXPIRED. An expired
        # mute must page — that expiry is the mechanism that forces a dead feed
        # back into view instead of letting it stay quietly dead.
        if muted_until is not None:
            pageable.append(
                f"{module_name} (slug {slug}): failed, and its mute EXPIRED at "
                f"{muted_until.isoformat()} — resolve it or re-mute deliberately"
            )
        else:
            pageable.append(f"{module_name} (slug {slug}): failed and is not muted")

    return pageable, suppressed


def fetch_feed_rows() -> dict[str, FeedRow]:
    """Read the mute roster. Raises on any DB problem so the caller pages."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT slug, enabled, muted_until, muted_reason
              FROM public.feed_sources
            """
        )
        rows = cursor.fetchall()
        cursor.close()
    return {slug: (enabled, muted_until, muted_reason) for slug, enabled, muted_until, muted_reason in rows}


def read_failures(path: str) -> list[str]:
    """Read the failure file. A missing file means no scraper failed."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        seen: list[str] = []
        for line in handle:
            name = line.strip()
            if name and name not in seen:
                seen.append(name)
    return seen


def _leading_identifier(entry: str) -> str:
    """First bare identifier in a formatted entry — the scraper module name."""
    match = re.match(r"\s*([A-Za-z0-9_]+)", entry)
    return match.group(1) if match else entry.strip()


def _export_for_notify(pageable: list[str], suppressed: list[str]) -> None:
    """Publish a one-line summary to $GITHUB_OUTPUT so the page can name names.

    The old Telegram body said only "Threat feed scraper failed" plus a run URL,
    so answering "which feed?" meant opening GitHub. An alert should carry its
    own evidence.

    $GITHUB_OUTPUT, not $GITHUB_ENV: notify-failure is a SEPARATE job, and
    GITHUB_ENV does not cross job boundaries — it would have arrived empty.
    """
    github_output = os.environ.get("GITHUB_OUTPUT")
    if not github_output:
        return
    # Entries are formatted "<module> (slug <slug>): <why>" or, on the
    # DB-unreachable path, a bare module name. Take the leading identifier so
    # the page reads "urlhaus", not "urlhaus (slug urlhaus)".
    names = ", ".join(_leading_identifier(entry) for entry in pageable) or "none"
    try:
        with open(github_output, "a", encoding="utf-8") as handle:
            handle.write(f"failed_scrapers={names}\n")
            handle.write(f"suppressed_count={len(suppressed)}\n")
    except OSError as exc:  # noqa: BLE001 — never break the gate over telemetry
        logger.warning("could not write GITHUB_OUTPUT: %s", exc)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--file",
        required=True,
        help="path to scraper_failures.txt (one scraper module name per line)",
    )
    args = parser.parse_args()

    failed = read_failures(args.file)
    if not failed:
        print("All scrapers completed without a hard error.")
        return 0

    try:
        feed_rows = fetch_feed_rows()
    except Exception as exc:  # noqa: BLE001 — cannot confirm mutes, so page everything
        _annotate(
            f"could not read feed_sources to check mutes ({exc}) — paging for "
            f"ALL {len(failed)} failed scraper(s) rather than risk suppressing "
            f"a live one: {', '.join(failed)}"
        )
        _export_for_notify(failed, [])
        return 1

    pageable, suppressed = partition_failures(failed, feed_rows)

    for entry in suppressed:
        # Recorded, not paged. The feed is still failing and health-digest still
        # sees it via feed_health.is_muted; the DB-side mute expiry is what
        # brings it back into alarms.
        print(f"SUPPRESSED (muted/disabled): {entry}")

    for entry in pageable:
        _annotate(entry)

    _export_for_notify(pageable, suppressed)

    if pageable:
        print(
            f"{len(pageable)} scraper(s) failed and are not muted; "
            f"{len(suppressed)} suppressed."
        )
        return 1

    print(
        f"All {len(suppressed)} failed scraper(s) are muted or disabled — "
        f"not paging. Mutes expire; see feed_sources.muted_until."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
