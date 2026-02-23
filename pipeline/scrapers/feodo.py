"""Feodo Tracker (abuse.ch) IP blocklist scraper — botnet C2 IPs.

Data source: https://feodotracker.abuse.ch/downloads/ipblocklist.json
Format: JSON array with IP details
License: CC0
"""

import time

import requests

from common.db import get_db, bulk_upsert_ips, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "feodo"
FEED_URL = "https://feodotracker.abuse.ch/downloads/ipblocklist.json"


def scrape() -> None:
    start = time.time()
    ips: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching Feodo Tracker blocklist from {FEED_URL}")
        resp = requests.get(FEED_URL, timeout=60)
        resp.raise_for_status()

        data = resp.json()
        if not isinstance(data, list):
            raise ValueError(f"Unexpected response format: {type(data)}")

        for entry in data:
            ip_addr = entry.get("ip_address", "").strip()
            if not ip_addr:
                continue

            port = entry.get("port")
            if port is not None:
                try:
                    port = int(port)
                except (ValueError, TypeError):
                    port = None

            as_number = entry.get("as_number")
            if as_number is not None:
                try:
                    as_number = int(as_number)
                except (ValueError, TypeError):
                    as_number = None

            ips.append({
                "ip_address": ip_addr,
                "port": port,
                "as_number": as_number,
                "as_name": entry.get("as_name") or None,
                "country": entry.get("country") or None,
                "threat_type": "botnet_c2",
                "blocklist_count": 1,
                "first_seen": entry.get("first_seen_utc") or None,
                "last_online": entry.get("last_online_utc") or None,
                "feed_reference_url": "https://feodotracker.abuse.ch",
            })

        logger.info(f"Parsed {len(ips)} IPs from Feodo Tracker")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"Feodo Tracker fetch failed: {e}")

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
                logger.error(f"Feodo Tracker upsert failed: {e}")
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
        f"Feodo Tracker complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
