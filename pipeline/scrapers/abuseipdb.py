"""AbuseIPDB blacklist scraper.

Data source: https://api.abuseipdb.com/api/v2/blacklist
Format: JSON (API key required)
License: Free tier — 1,000 requests/day, max 10,000 IPs per request

Requires ABUSEIPDB_API_KEY environment variable.
"""

import os
import time

import requests

from common.db import get_db, bulk_upsert_ips, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "abuseipdb"
FEED_URL = "https://api.abuseipdb.com/api/v2/blacklist"
# Minimum abuse confidence score (0-100) to include
MIN_CONFIDENCE = 75


def scrape() -> None:
    start = time.time()
    ips: list[dict] = []
    error_msg = None
    status = "success"

    api_key = os.environ.get("ABUSEIPDB_API_KEY")
    if not api_key:
        logger.error("ABUSEIPDB_API_KEY not set, skipping")
        with get_db() as conn:
            log_ingestion(
                conn,
                feed_name=FEED_NAME,
                status="error",
                error_message="ABUSEIPDB_API_KEY not configured",
                record_type="ip",
            )
        return

    try:
        logger.info(f"Fetching AbuseIPDB blacklist (minConfidence={MIN_CONFIDENCE})")
        resp = requests.get(
            FEED_URL,
            headers={
                "Key": api_key,
                "Accept": "application/json",
            },
            params={
                "confidenceMinimum": str(MIN_CONFIDENCE),
                "limit": "10000",
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()

        for entry in data.get("data", []):
            ip_addr = entry.get("ipAddress", "").strip()
            if not ip_addr:
                continue
            ips.append({
                "ip_address": ip_addr,
                "country": entry.get("countryCode"),
                "threat_type": "malicious",
                "blocklist_count": entry.get("abuseConfidenceScore", 0),
                "feed_reference_url": f"https://www.abuseipdb.com/check/{ip_addr}",
            })

        logger.info(f"Parsed {len(ips)} IPs from AbuseIPDB")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"AbuseIPDB fetch failed: {e}")

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
                logger.error(f"AbuseIPDB upsert failed: {e}")
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
        f"AbuseIPDB complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
