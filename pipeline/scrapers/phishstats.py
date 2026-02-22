"""PhishStats JSON API scraper — high-confidence phishing URLs (score >= 5).

Data source: https://phishstats.info/phish_score.csv (or JSON API)
API endpoint: https://phishstats.info:2096/api/phishing?_where=(score,gte,5)&_sort=-date&_size=1000
"""

import time

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "phishstats"
API_URL = "https://phishstats.info:2096/api/phishing"
MIN_SCORE = 5
PAGE_SIZE = 1000


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info("Fetching PhishStats API (score >= 5)")
        resp = requests.get(
            API_URL,
            params={
                "_where": f"(score,gte,{MIN_SCORE})",
                "_sort": "-date",
                "_size": str(PAGE_SIZE),
            },
            timeout=60,
        )
        resp.raise_for_status()

        data = resp.json()
        if not isinstance(data, list):
            raise ValueError(f"Unexpected response format: {type(data)}")

        for entry in data:
            raw_url = entry.get("url", "").strip()
            if not raw_url:
                continue

            urls.append(
                {
                    "url": raw_url,
                    "scam_type": "phishing",
                }
            )

        logger.info(f"Parsed {len(urls)} high-score URLs from PhishStats")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"PhishStats fetch failed: {e}")

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
                logger.error(f"PhishStats upsert failed: {e}")
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
        f"PhishStats complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
