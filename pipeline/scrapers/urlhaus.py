"""URLhaus (abuse.ch) bulk CSV scraper — online URLs only, with threat type mapping.

Data source: https://urlhaus.abuse.ch/downloads/csv_online/
Format: CSV with comment lines starting with #
Columns: id, dateadded, url, url_status, last_online, threat, tags, urlhaus_link, reporter
"""

import csv
import io
import time

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "urlhaus"
CSV_URL = "https://urlhaus.abuse.ch/downloads/csv_online/"

# Map URLhaus threat types to our scam_type taxonomy
THREAT_TYPE_MAP = {
    "malware_download": "malware",
    "phishing": "phishing",
    "cryptomining": "cryptomining",
}


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching URLhaus CSV from {CSV_URL}")
        resp = requests.get(CSV_URL, timeout=60)
        resp.raise_for_status()

        # Skip comment lines (start with #)
        lines = [
            line
            for line in resp.text.splitlines()
            if line and not line.startswith("#")
        ]

        reader = csv.reader(lines)
        for row in reader:
            if len(row) < 7:
                continue
            # Columns: id, dateadded, url, url_status, last_online, threat, tags, ...
            dateadded = row[1].strip('"').strip() or None
            raw_url = row[2].strip('"').strip()
            threat = row[5].strip('"').strip().lower()

            urls.append(
                {
                    "url": raw_url,
                    "scam_type": THREAT_TYPE_MAP.get(threat, threat or None),
                    "feed_reported_at": dateadded,
                }
            )

        logger.info(f"Parsed {len(urls)} online URLs from URLhaus")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"URLhaus fetch failed: {e}")

    # Upsert to database
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
                logger.error(f"URLhaus upsert failed: {e}")
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
        f"URLhaus complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
