"""ACCC Scamwatch RSS feed scraper.

Data source: https://www.scamwatch.gov.au/rss
Format: RSS/XML — Australian government scam alerts and warnings
License: CC BY 3.0 AU

Extracts scam alerts from the ACCC Scamwatch RSS feed. These are
advisory-level entries (not individual URLs/IPs), stored as URLs
pointing to the Scamwatch alert page.
"""

import time
import xml.etree.ElementTree as ET

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "scamwatch_au"
FEED_URL = "https://www.scamwatch.gov.au/rss"


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching Scamwatch RSS from {FEED_URL}")
        resp = requests.get(
            FEED_URL,
            timeout=60,
            headers={"User-Agent": "AskArthur-ThreatFeed/1.0 (+https://askarthur.au)"},
        )
        resp.raise_for_status()

        root = ET.fromstring(resp.text)
        channel = root.find("channel")
        if channel is None:
            raise ValueError("No <channel> element in RSS feed")

        for item in channel.findall("item"):
            title = item.findtext("title", "").strip()
            link = item.findtext("link", "").strip()
            pub_date = item.findtext("pubDate", "").strip()
            description = item.findtext("description", "").strip()

            if not link:
                continue

            # Infer scam type from title keywords
            scam_type = _infer_scam_type(title, description)

            urls.append({
                "url": link,
                "scam_type": scam_type,
                "brand": _extract_brand(title),
                "feed_reported_at": pub_date or None,
                "feed_reference_url": link,
                "country_code": "AU",
            })

        logger.info(f"Parsed {len(urls)} alerts from Scamwatch RSS")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"Scamwatch RSS fetch failed: {e}")

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
                logger.error(f"Scamwatch upsert failed: {e}")
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
        f"Scamwatch complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


def _infer_scam_type(title: str, description: str) -> str:
    """Infer scam type from alert title/description keywords."""
    text = f"{title} {description}".lower()
    if any(w in text for w in ["phishing", "fake email", "fake sms"]):
        return "phishing"
    if any(w in text for w in ["investment", "crypto", "bitcoin", "ponzi"]):
        return "investment_fraud"
    if any(w in text for w in ["romance", "dating", "love"]):
        return "romance_scam"
    if any(w in text for w in ["remote access", "tech support", "teamviewer"]):
        return "tech_support"
    if any(w in text for w in ["impersonat", "government", "ato", "myGov"]):
        return "impersonation"
    if any(w in text for w in ["shopping", "online store", "fake product"]):
        return "shopping_scam"
    return "other"


def _extract_brand(title: str) -> str | None:
    """Extract impersonated brand from title if recognizable."""
    brands = [
        "CommBank", "ANZ", "Westpac", "NAB", "CBA",
        "ATO", "myGov", "Centrelink", "Medicare",
        "Telstra", "Optus", "Amazon", "Netflix",
        "Australia Post", "Auspost",
    ]
    title_lower = title.lower()
    for brand in brands:
        if brand.lower() in title_lower:
            return brand
    return None


if __name__ == "__main__":
    scrape()
