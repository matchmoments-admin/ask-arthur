"""ThreatFox (abuse.ch) API scraper — multi-type IOCs (URLs + IPs).

Data source: https://threatfox-api.abuse.ch/api/v1/
Format: JSON POST API, returns IOCs from the last N days.
License: CC0
"""

import time

import requests

from common.db import get_db, bulk_upsert_urls, bulk_upsert_ips, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "threatfox"
API_URL = "https://threatfox-api.abuse.ch/api/v1/"

# Map ThreatFox threat_type_desc to our taxonomy
THREAT_TYPE_MAP = {
    "botnet_cc": "botnet_c2",
    "payload_delivery": "malware",
    "c2": "botnet_c2",
    "credential_phishing": "phishing",
}


def _map_threat_type(threat_type_desc: str) -> str | None:
    """Map ThreatFox threat type to our taxonomy."""
    key = threat_type_desc.lower().strip()
    return THREAT_TYPE_MAP.get(key, key or None)


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    ips: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info("Fetching ThreatFox IOCs (last 7 days)")
        resp = requests.post(
            API_URL,
            json={"query": "get_iocs", "days": 7},
            timeout=120,
        )
        resp.raise_for_status()

        data = resp.json()
        if data.get("query_status") != "ok":
            raise ValueError(f"ThreatFox query failed: {data.get('query_status')}")

        iocs = data.get("data", [])
        if not isinstance(iocs, list):
            raise ValueError(f"Unexpected data format: {type(iocs)}")

        for ioc in iocs:
            ioc_type = ioc.get("ioc_type", "").lower()
            ioc_value = ioc.get("ioc", "").strip()
            threat_type = _map_threat_type(ioc.get("threat_type_desc", ""))
            first_seen = ioc.get("first_seen_utc") or None
            reference = ioc.get("reference") or None
            malware = ioc.get("malware_printable") or None

            if not ioc_value:
                continue

            if ioc_type in ("url", "domain"):
                # Domains need a scheme
                if ioc_type == "domain" and not ioc_value.startswith(("http://", "https://")):
                    ioc_value = f"http://{ioc_value}"
                urls.append({
                    "url": ioc_value,
                    "scam_type": threat_type,
                    "brand": malware,
                    "feed_reported_at": first_seen,
                    "feed_reference_url": reference,
                })
            elif ioc_type == "ip:port":
                # Parse "ip:port" format
                parts = ioc_value.rsplit(":", 1)
                ip_addr = parts[0]
                port = None
                if len(parts) == 2:
                    try:
                        port = int(parts[1])
                    except ValueError:
                        pass
                ips.append({
                    "ip_address": ip_addr,
                    "port": port,
                    "threat_type": threat_type,
                    "blocklist_count": 1,
                    "feed_reported_at": first_seen,
                    "feed_reference_url": reference,
                })

        logger.info(f"Parsed {len(urls)} URLs and {len(ips)} IPs from ThreatFox")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"ThreatFox fetch failed: {e}")

    with get_db() as conn:
        # Upsert URLs
        url_stats = {"new": 0, "updated": 0, "skipped": 0}
        if urls:
            try:
                url_stats = bulk_upsert_urls(conn, urls, FEED_NAME)
            except Exception as e:
                error_msg = str(e)
                status = "error"
                url_stats = {"new": 0, "updated": 0, "skipped": len(urls)}
                logger.error(f"ThreatFox URL upsert failed: {e}")

        # Upsert IPs
        ip_stats = {"new": 0, "updated": 0, "skipped": 0}
        if ips:
            try:
                ip_stats = bulk_upsert_ips(conn, ips, FEED_NAME)
            except Exception as e:
                error_msg = str(e)
                status = "error"
                ip_stats = {"new": 0, "updated": 0, "skipped": len(ips)}
                logger.error(f"ThreatFox IP upsert failed: {e}")

        if status != "error":
            all_skipped = (
                url_stats["skipped"] + ip_stats["skipped"] > 0
                and url_stats["new"] + ip_stats["new"] == 0
                and url_stats["updated"] + ip_stats["updated"] == 0
            )
            if all_skipped:
                status = "partial"

        duration_ms = int((time.time() - start) * 1000)

        # Log URL ingestion
        if urls or not ips:
            log_ingestion(
                conn,
                feed_name=FEED_NAME,
                status=status,
                records_fetched=len(urls),
                records_new=url_stats["new"],
                records_updated=url_stats["updated"],
                records_skipped=url_stats["skipped"],
                duration_ms=duration_ms,
                error_message=error_msg,
                record_type="url",
            )

        # Log IP ingestion
        if ips:
            log_ingestion(
                conn,
                feed_name=FEED_NAME,
                status=status,
                records_fetched=len(ips),
                records_new=ip_stats["new"],
                records_updated=ip_stats["updated"],
                records_skipped=ip_stats["skipped"],
                duration_ms=duration_ms,
                error_message=error_msg,
                record_type="ip",
            )

    logger.info(
        f"ThreatFox complete: URLs({url_stats['new']} new, {url_stats['updated']} updated), "
        f"IPs({ip_stats['new']} new, {ip_stats['updated']} updated) in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
