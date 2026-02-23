"""CryptoScamDB scraper — scam crypto wallet addresses.

Data source: https://raw.githubusercontent.com/CryptoScamDB/blacklist/master/data/urls.json
Format: JSON object keyed by domain with wallet/scam info
License: Open source
"""

import time

import requests

from common.db import get_db, bulk_upsert_crypto_wallets, log_ingestion
from common.logging_config import get_logger
from common.validate import validate_eth_address, validate_btc_address

logger = get_logger(__name__)

FEED_NAME = "cryptoscamdb"
FEED_URL = "https://raw.githubusercontent.com/CryptoScamDB/blacklist/master/data/urls.json"


def _detect_chain(address: str) -> str:
    """Detect blockchain from address format."""
    if validate_eth_address(address):
        return "ETH"
    if validate_btc_address(address):
        return "BTC"
    return "OTHER"


def scrape() -> None:
    start = time.time()
    wallets: list[dict] = []
    seen_addresses: set[str] = set()
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching CryptoScamDB data from {FEED_URL}")
        resp = requests.get(FEED_URL, timeout=60)
        resp.raise_for_status()

        data = resp.json()
        if not isinstance(data, dict):
            raise ValueError(f"Unexpected response format: {type(data)}")

        for domain, entries in data.items():
            if not isinstance(entries, list):
                entries = [entries]
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                # Extract wallet addresses from various fields
                addresses = []
                for field in ("addresses", "address"):
                    val = entry.get(field)
                    if isinstance(val, list):
                        addresses.extend(val)
                    elif isinstance(val, str) and val.strip():
                        addresses.append(val.strip())

                scam_type = entry.get("category") or entry.get("subcategory") or None
                url = entry.get("url") or f"http://{domain}"

                for addr in addresses:
                    addr = addr.strip()
                    if not addr or addr in seen_addresses:
                        continue

                    # Validate address format
                    if not validate_eth_address(addr) and not validate_btc_address(addr):
                        continue

                    seen_addresses.add(addr)
                    wallets.append({
                        "address": addr,
                        "chain": _detect_chain(addr),
                        "associated_url": url,
                        "associated_domain": domain,
                        "scam_type": scam_type,
                        "feed_reference_url": "https://github.com/CryptoScamDB/blacklist",
                    })

        logger.info(f"Parsed {len(wallets)} wallet addresses from CryptoScamDB")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"CryptoScamDB fetch failed: {e}")

    with get_db() as conn:
        if wallets:
            try:
                stats = bulk_upsert_crypto_wallets(conn, wallets, FEED_NAME)
                if stats["skipped"] > 0 and stats["new"] == 0 and stats["updated"] == 0:
                    status = "partial"
            except Exception as e:
                error_msg = str(e)
                status = "error"
                stats = {"new": 0, "updated": 0, "skipped": len(wallets)}
                logger.error(f"CryptoScamDB upsert failed: {e}")
        else:
            stats = {"new": 0, "updated": 0, "skipped": 0}

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=len(wallets),
            records_new=stats["new"],
            records_updated=stats["updated"],
            records_skipped=stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="crypto_wallet",
        )

    logger.info(
        f"CryptoScamDB complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
