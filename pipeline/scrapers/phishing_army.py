"""Phishing Army blocklist scraper — domains converted to URLs.

Data source: https://phishing.army/download/phishing_army_blocklist_extended.txt
Format: Plain text, 1 domain/line
License: Free
"""

import time

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "phishing_army"
FEED_URL = "https://phishing.army/download/phishing_army_blocklist_extended.txt"


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching Phishing Army blocklist from {FEED_URL}")
        resp = requests.get(FEED_URL, timeout=60)
        resp.raise_for_status()

        for line in resp.text.splitlines():
            domain = line.strip()
            if not domain or domain.startswith(("#", "!")):
                continue
            # Prepend scheme (same pattern as phishing_database.py)
            urls.append({
                "url": f"http://{domain}",
                "scam_type": "phishing",
                "feed_reference_url": "https://phishing.army",
            })

        logger.info(f"Parsed {len(urls)} domains from Phishing Army")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"Phishing Army fetch failed: {e}")

    with get_db() as conn:
        if urls:
            try:
                stats = bulk_upsert_urls(conn, urls, FEED_NAME)
                if stats["skipped"] > 0 and stats["new"] == 0 and stats["updated"] == 0:
                    status = "partial"
            except Exception as e:
                error_msg = str(e)
                status = "error"
                stats = {"new": 0, "updated": 0, "skipped": len(urls)}
                logger.error(f"Phishing Army upsert failed: {e}")
        else:
            stats = {"new": 0, "updated": 0, "skipped": 0}

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=len(urls),
            records_new=stats["new"],
            records_updated=stats["updated"],
            records_skipped=stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="url",
        )

    logger.info(
        f"Phishing Army complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
