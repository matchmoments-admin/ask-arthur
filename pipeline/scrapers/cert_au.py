"""CERT Australia (ACSC) advisory feed scraper.

Data source: https://www.cyber.gov.au/api/v1/advisories
Format: JSON API — Australian Cyber Security Centre advisories
License: CC BY 4.0

Extracts cybersecurity advisories from ACSC (the Australian government CERT).
These are high-quality, manually-curated threat alerts.
"""

import time

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "cert_au"
# ACSC provides a public advisory listing
FEED_URL = "https://www.cyber.gov.au/api/v1/advisories"
# Fallback: scrape the RSS feed if available
RSS_URL = "https://www.cyber.gov.au/about-us/view-all-content/advisories/rss.xml"


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    error_msg = None
    status = "success"

    try:
        # Try JSON API first
        urls = _fetch_json_api()
    except Exception as e:
        logger.warning(f"CERT AU JSON API failed, trying RSS: {e}")
        try:
            urls = _fetch_rss()
        except Exception as e2:
            error_msg = f"JSON: {e} | RSS: {e2}"
            status = "error"
            logger.error(f"CERT AU all sources failed: {error_msg}")

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
                logger.error(f"CERT AU upsert failed: {e}")
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
        )

    logger.info(
        f"CERT AU complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


def _fetch_json_api() -> list[dict]:
    """Fetch advisories from the ACSC JSON API."""
    logger.info(f"Fetching CERT AU advisories from {FEED_URL}")
    resp = requests.get(
        FEED_URL,
        timeout=60,
        headers={"User-Agent": "AskArthur-ThreatFeed/1.0 (+https://askarthur.au)"},
        params={"limit": "50", "sort": "-date"},
    )
    resp.raise_for_status()
    data = resp.json()

    urls: list[dict] = []
    advisories = data if isinstance(data, list) else data.get("data", data.get("results", []))

    for advisory in advisories:
        url = advisory.get("url") or advisory.get("link") or advisory.get("canonical_url")
        if not url:
            # Build URL from ID if possible
            advisory_id = advisory.get("id") or advisory.get("slug")
            if advisory_id:
                url = f"https://www.cyber.gov.au/about-us/advisories/{advisory_id}"
            else:
                continue

        title = advisory.get("title", "")
        scam_type = _classify_advisory(title, advisory.get("description", ""))

        urls.append({
            "url": url,
            "scam_type": scam_type,
            "brand": None,
            "feed_reported_at": advisory.get("date") or advisory.get("published_at"),
            "feed_reference_url": url,
            "country_code": "AU",
        })

    logger.info(f"Parsed {len(urls)} advisories from CERT AU JSON API")
    return urls


def _fetch_rss() -> list[dict]:
    """Fallback: fetch advisories from ACSC RSS feed."""
    import xml.etree.ElementTree as ET

    logger.info(f"Fetching CERT AU RSS from {RSS_URL}")
    resp = requests.get(
        RSS_URL,
        timeout=60,
        headers={"User-Agent": "AskArthur-ThreatFeed/1.0 (+https://askarthur.au)"},
    )
    resp.raise_for_status()

    root = ET.fromstring(resp.text)
    channel = root.find("channel")
    if channel is None:
        raise ValueError("No <channel> element in RSS feed")

    urls: list[dict] = []
    for item in channel.findall("item"):
        link = item.findtext("link", "").strip()
        if not link:
            continue
        title = item.findtext("title", "")
        description = item.findtext("description", "")
        pub_date = item.findtext("pubDate", "")

        urls.append({
            "url": link,
            "scam_type": _classify_advisory(title, description),
            "brand": None,
            "feed_reported_at": pub_date or None,
            "feed_reference_url": link,
            "country_code": "AU",
        })

    logger.info(f"Parsed {len(urls)} advisories from CERT AU RSS")
    return urls


def _classify_advisory(title: str, description: str) -> str:
    """Classify advisory type from title/description."""
    text = f"{title} {description}".lower()
    if any(w in text for w in ["ransomware", "ransom"]):
        return "ransomware"
    if any(w in text for w in ["phishing", "credential"]):
        return "phishing"
    if any(w in text for w in ["malware", "trojan", "backdoor"]):
        return "malware"
    if any(w in text for w in ["vulnerability", "cve", "patch"]):
        return "vulnerability"
    if any(w in text for w in ["ddos", "denial of service"]):
        return "ddos"
    return "advisory"


if __name__ == "__main__":
    scrape()
