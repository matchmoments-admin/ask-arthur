"""Phishing.Database text file scraper — one URL per line.

Data source: https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-links-ACTIVE-NOW.txt
Simplest scraper — no parsing needed, just one URL per line.
"""

import time

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "phishing_database"
TEXT_URL = "https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-links-ACTIVE-NOW.txt"


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching Phishing.Database from {TEXT_URL}")
        resp = requests.get(TEXT_URL, timeout=60)
        resp.raise_for_status()

        for line in resp.text.splitlines():
            raw_url = line.strip()
            if not raw_url or raw_url.startswith("#"):
                continue
            # Ensure URL has a scheme
            if not raw_url.startswith(("http://", "https://")):
                raw_url = f"http://{raw_url}"
            urls.append({
                "url": raw_url,
                "scam_type": "phishing",
                "feed_reference_url": "https://github.com/mitchellkrogza/Phishing.Database",
            })

        logger.info(f"Parsed {len(urls)} URLs from Phishing.Database")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"Phishing.Database fetch failed: {e}")

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
                logger.error(f"Phishing.Database upsert failed: {e}")
        else:
            stats = {"new": 0, "updated": 0, "skipped": 0}

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            urls_fetched=len(urls),
            urls_new=stats["new"],
            urls_updated=stats["updated"],
            urls_skipped=stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
        )

    logger.info(
        f"Phishing.Database complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
