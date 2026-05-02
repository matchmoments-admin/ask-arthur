"""PFRA member registry — local Postgres mirror.

Data source: https://pfra.org.au/membership/{charity-members,fundraising-agency-members}/
License:     Public list (PFRA explicitly publishes member directories)
Refresh:     Source updates ~quarterly; scraper runs weekly.

The two pages have slightly different HTML structures:
  * /charity-members/         — names live in <h4 class="card-title">NAME</h4>
  * /fundraising-agency-members/ — names live in <h4 style="..."><span ...>NAME</span></h4>

Both render in WordPress so we use BeautifulSoup with an h4-text fallback
that handles both markup variants and a stopword/UI-text filter for the
WordPress chrome (Quick Links, Contact Us, etc.).
"""

import os
import re
import time
from typing import Iterable

import psycopg2
import psycopg2.extras
import requests
from bs4 import BeautifulSoup

from common.db import get_db, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "pfra_members"
USER_AGENT = "AskArthur-CharityCheck/1.0 (+https://askarthur.au)"

SOURCES = [
    ("charity", "https://pfra.org.au/membership/charity-members/"),
    ("agency", "https://pfra.org.au/membership/fundraising-agency-members/"),
]

# WordPress chrome / nav items that appear inside <h4>s on the page but
# aren't member names. We filter them out by exact match (case-insensitive).
UI_NOISE = {
    "what we do",
    "charity members",
    "fundraising agency members",
    "agency members",
    "quick links",
    "contact us",
    "about pfra",
    "membership",
    "members area",
    "page not found",
    "find a charity",
    "our work",
    "publications",
    "news",
}

UPSERT_SQL = """
INSERT INTO pfra_members (name, name_normalized, member_type, source_url)
VALUES %s
ON CONFLICT (name, member_type) DO UPDATE SET
  name_normalized = EXCLUDED.name_normalized,
  source_url      = EXCLUDED.source_url,
  updated_at      = NOW()
RETURNING (xmax = 0) AS is_new
"""


def normalize_name(name: str) -> str:
    """Lowercase + strip punctuation. Mirrors the SQL normalization used
    by the lookup_pfra_member RPC + backfill function so name_normalized
    is comparable across both ingestion and query paths."""
    return re.sub(r"[^a-z0-9 ]+", "", name.lower()).strip()


def extract_member_names(html: str) -> list[str]:
    """Pull member names from a PFRA membership page's HTML.

    Strategy: find every <h4>, take its visible text, then filter out
    WordPress UI noise. Both the charity-members and agency-members pages
    use <h4> for names (the charity page adds class='card-title'; the
    agency page wraps the inner text in a colored <span>). The
    BeautifulSoup .get_text() call handles both shapes.
    """
    soup = BeautifulSoup(html, "html.parser")
    names: list[str] = []
    for h4 in soup.find_all("h4"):
        text = h4.get_text(strip=True)
        if not text:
            continue
        # Remove HTML entities BeautifulSoup didn't decode (rare).
        text = text.replace("\xa0", " ").strip()
        # Skip UI noise + obvious nav items.
        if text.lower() in UI_NOISE:
            continue
        if len(text) < 3 or len(text) > 200:
            continue
        names.append(text)
    return names


def fetch_page(url: str) -> str:
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.text


def upsert_members(conn, rows: Iterable[tuple[str, str, str, str]]) -> dict:
    stats = {"new": 0, "updated": 0, "skipped": 0}
    cursor = conn.cursor()
    rows_list = list(rows)
    if not rows_list:
        return stats
    try:
        results = psycopg2.extras.execute_values(
            cursor,
            UPSERT_SQL,
            rows_list,
            fetch=True,
        )
        for row in results:
            if row[0]:
                stats["new"] += 1
            else:
                stats["updated"] += 1
        conn.commit()
    except Exception as e:
        conn.rollback()
        stats["skipped"] = len(rows_list)
        logger.error(f"PFRA upsert failed: {e}")
    finally:
        cursor.close()
    return stats


def run_backfill(conn) -> int:
    """Run the SQL backfill that joins PFRA members to ACNC ABNs by
    normalized-name match. Returns the number of rows updated. Best-effort
    — failure logs and returns 0."""
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT backfill_pfra_member_abns()")
        result = cursor.fetchone()
        conn.commit()
        return int(result[0]) if result else 0
    except Exception as e:
        conn.rollback()
        logger.warning(f"PFRA ABN backfill failed: {e}")
        return 0
    finally:
        cursor.close()


def scrape() -> None:
    """Entry point. Gated by FF_CHARITY_CHECK_INGEST so an accidental run
    on a fresh checkout (or a partially-configured CI environment) is a
    no-op."""
    if os.environ.get("FF_CHARITY_CHECK_INGEST", "").strip().lower() != "true":
        logger.info("FF_CHARITY_CHECK_INGEST not set to 'true' — skipping PFRA scrape")
        return

    start = time.time()
    error_msg: str | None = None
    status = "success"
    rows: list[tuple[str, str, str, str]] = []

    try:
        for member_type, url in SOURCES:
            logger.info(f"Fetching PFRA {member_type} members from {url}")
            html = fetch_page(url)
            names = extract_member_names(html)
            logger.info(f"PFRA {member_type}: {len(names)} names extracted")
            for name in names:
                rows.append((name, normalize_name(name), member_type, url))
    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"PFRA fetch failed: {e}")

    stats = {"new": 0, "updated": 0, "skipped": 0}
    backfilled = 0
    with get_db() as conn:
        if rows and status != "error":
            stats = upsert_members(conn, rows)
            try:
                backfilled = run_backfill(conn)
                logger.info(f"PFRA ABN backfill matched {backfilled} rows to acnc_charities")
            except Exception as e:
                logger.warning(f"PFRA backfill error (non-fatal): {e}")

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=len(rows),
            records_new=stats["new"],
            records_updated=stats["updated"],
            records_skipped=stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="charity",  # PFRA rows are charity-domain; reuse the v84 allowlist entry
        )

    logger.info(
        f"PFRA scrape complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped, {backfilled} ABNs backfilled in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
