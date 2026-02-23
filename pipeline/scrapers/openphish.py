"""OpenPhish feed scraper — community phishing URLs, one per line.

Data source: https://openphish.com/feed.txt
Format: Plain text, 1 URL/line
License: Non-commercial OK
"""

import time

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "openphish"
FEED_URL = "https://openphish.com/feed.txt"


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching OpenPhish feed from {FEED_URL}")
        resp = requests.get(FEED_URL, timeout=60)
        resp.raise_for_status()

        for line in resp.text.splitlines():
            raw_url = line.strip()
            if not raw_url or raw_url.startswith("#"):
                continue
            urls.append({
                "url": raw_url,
                "scam_type": "phishing",
                "feed_reference_url": "https://openphish.com",
            })

        logger.info(f"Parsed {len(urls)} URLs from OpenPhish")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"OpenPhish fetch failed: {e}")

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
                logger.error(f"OpenPhish upsert failed: {e}")
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
        f"OpenPhish complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
