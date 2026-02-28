"""Spamhaus DROP/EDROP list scraper.

Data source:
  - DROP: https://www.spamhaus.org/drop/drop.txt  (hijacked IP ranges)
  - EDROP: https://www.spamhaus.org/drop/edrop.txt (extended drop list)
Format: CIDR\t; SBL-ID, one per line, ; comments
License: Free for non-commercial use

These are IP ranges allocated to spammers or hijacked for spam.
We store the CIDR prefix as the IP address for lookups.
"""

import time

import requests

from common.db import get_db, bulk_upsert_ips, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "spamhaus"
DROP_URL = "https://www.spamhaus.org/drop/drop.txt"
EDROP_URL = "https://www.spamhaus.org/drop/edrop.txt"


def _parse_drop_list(text: str, list_name: str) -> list[dict]:
    """Parse a Spamhaus DROP/EDROP text file into IP records."""
    ips: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(";"):
            continue
        parts = line.split(";")
        cidr = parts[0].strip()
        sbl_id = parts[1].strip() if len(parts) > 1 else None
        # Extract the network address from CIDR notation
        ip_addr = cidr.split("/")[0].strip()
        if not ip_addr:
            continue
        ips.append({
            "ip_address": ip_addr,
            "threat_type": "hijacked" if list_name == "drop" else "spam_infrastructure",
            "blocklist_count": 1,
            "feed_reference_url": f"https://www.spamhaus.org/sbl/query/{sbl_id}" if sbl_id else "https://www.spamhaus.org/drop/",
        })
    return ips


def scrape() -> None:
    start = time.time()
    ips: list[dict] = []
    error_msg = None
    status = "success"

    try:
        # Fetch both DROP and EDROP lists
        for url, name in [(DROP_URL, "drop"), (EDROP_URL, "edrop")]:
            logger.info(f"Fetching Spamhaus {name.upper()} from {url}")
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()
            parsed = _parse_drop_list(resp.text, name)
            ips.extend(parsed)
            logger.info(f"Parsed {len(parsed)} IPs from Spamhaus {name.upper()}")

        logger.info(f"Total: {len(ips)} IPs from Spamhaus DROP+EDROP")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"Spamhaus fetch failed: {e}")

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
                logger.error(f"Spamhaus upsert failed: {e}")
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
        f"Spamhaus complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
