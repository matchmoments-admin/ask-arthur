"""IPsum (stamparm) IP reputation feed scraper.

Data source: https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt
Format: IP\tcount, one per line, # comments
License: Free

The count represents how many blocklists include this IP — used as
blocklist_count for confidence scoring (score = count/8, capped at 1.0).
"""

import time

import requests

from common.db import get_db, bulk_upsert_ips, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "ipsum"
FEED_URL = "https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt"


def scrape() -> None:
    start = time.time()
    ips: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching IPsum feed from {FEED_URL}")
        resp = requests.get(FEED_URL, timeout=60)
        resp.raise_for_status()

        for line in resp.text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            ip_addr = parts[0].strip()
            try:
                count = int(parts[1].strip())
            except ValueError:
                continue
            ips.append({
                "ip_address": ip_addr,
                "blocklist_count": count,
                "threat_type": "malicious",
                "feed_reference_url": "https://github.com/stamparm/ipsum",
            })

        logger.info(f"Parsed {len(ips)} IPs from IPsum")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"IPsum fetch failed: {e}")

    with get_db() as conn:
        if ips:
            try:
                stats = bulk_upsert_ips(conn, ips, FEED_NAME)
                if stats["skipped"] > 0 and stats["new"] == 0 and stats["updated"] == 0:
                    status = "partial"
            except Exception as e:
                error_msg = str(e)
                status = "error"
                stats = {"new": 0, "updated": 0, "skipped": len(ips)}
                logger.error(f"IPsum upsert failed: {e}")
        else:
            stats = {"new": 0, "updated": 0, "skipped": 0}

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=len(ips),
            records_new=stats["new"],
            records_updated=stats["updated"],
            records_skipped=stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="ip",
        )

    logger.info(
        f"IPsum complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
