"""AUSTRAC media releases — RSS narrative scraper.

Source listing: https://www.austrac.gov.au/news-and-media/media-release
RSS feed:      https://www.austrac.gov.au/media-release/rss.xml

AUSTRAC publishes money-mule and payments-fraud typology reports under
media releases. These are highest-signal for romance-scam and
investment-scam blog content because the financial-intelligence detail
(mule networks, transfer patterns) doesn't appear in the consumer
regulators' alerts.

Cadence: daily 16:00 UTC tier. AUSTRAC releases are low-volume —
typically 1-3/week — so a once-a-day RSS pull is plenty.
License: Crown copyright, CC BY 4.0. Attribute "Source: AUSTRAC".

Template-mirror of acsc_alerts.py (same RSS structure, same upsert
helpers, same backoff gate). First Phase B vertical slice — validates
the corrected template before B5/B1a/B6 land.

URL note: AUSTRAC's Drupal RSS path was the closest match observable
from their site structure (mirrors the /rss/<section> shape used by
cyber.gov.au). If prod smoke shows a 404 on first run, update the URL
constant + the feed_sources row in one place.
"""
from __future__ import annotations

import hashlib
import re
import time
import xml.etree.ElementTree as ET

from common.backoff import enforce_backoff_or_skip
from common.db import (
    bulk_upsert_narrative_feed_items,
    bulk_upsert_urls,
    get_db,
    log_ingestion,
)
from common.http_cache import conditional_get
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "austrac"
FEED_URL = "https://www.austrac.gov.au/media-release/rss.xml"
BACKOFF_THRESHOLD = 3

URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def _hash_external_id(link: str) -> str:
    return hashlib.sha256(link.encode("utf-8")).hexdigest()[:32]


def _parse_rss(xml_text: str) -> list[dict]:
    """Parse RSS into normalised feed_items dicts. Empty list on parse error."""
    items: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        logger.error(f"AUSTRAC RSS parse failed: {e}")
        return items

    channel = root.find("channel")
    if channel is None:
        return items

    for it in channel.findall("item"):
        link = (it.findtext("link") or "").strip()
        title = (it.findtext("title") or "").strip()
        if not link or not title:
            continue
        description = (it.findtext("description") or "").strip()
        pub_date = (it.findtext("pubDate") or "").strip() or None
        tags = [
            (c.text or "").strip()
            for c in it.findall("category")
            if (c.text or "").strip()
        ]

        items.append({
            "source": "austrac",
            "external_id": _hash_external_id(link),
            "title": title,
            "description": description[:2000] if description else None,
            "body_md": description or None,
            "url": link,
            "source_url": link,
            "category": _infer_category(title, description),
            "country_code": "AU",
            "tags": tags + ["media_release"],
            "published_at": pub_date,
            "source_created_at": pub_date,
            "provenance_tier": "tier_1_regulator",
        })
    return items


def _infer_category(title: str, description: str) -> str:
    """Best-effort category from AUSTRAC's typical release topics.

    AUSTRAC media releases skew towards money-laundering / payments-fraud /
    typology reports. Most don't fit the consumer-scam taxonomy cleanly,
    so default to 'informational' and let downstream clustering tag them
    properly via embeddings.
    """
    text = f"{title} {description}".lower()
    # Order matters — specific patterns first, generic 'scam/fraud' last.
    # Otherwise an "investment scam" article matches 'scam' before reaching
    # the investment_fraud branch and gets mislabelled as impersonation.
    if any(w in text for w in ("mule", "money laundering", "amlctf", "aml/ctf")):
        return "informational"
    if any(w in text for w in ("romance",)):
        return "romance_scam"
    if any(w in text for w in ("crypto", "investment", "pig butcher", "pig-butcher")):
        return "investment_fraud"
    if any(w in text for w in ("impersonat",)):
        return "impersonation"
    if any(w in text for w in ("scam", "fraud")):
        return "impersonation"
    return "informational"


def _extract_urls_from_body(body: str | None, source_link: str) -> list[dict]:
    if not body:
        return []
    urls: list[dict] = []
    seen: set[str] = set()
    for match in URL_PATTERN.findall(body):
        clean = match.rstrip(".,);:'\"")
        if clean in seen:
            continue
        seen.add(clean)
        urls.append({
            "url": clean,
            "scam_type": "other",
            "feed_reported_at": None,
            "feed_reference_url": source_link,
            "country_code": "AU",
        })
    return urls


def scrape() -> None:
    if enforce_backoff_or_skip(FEED_NAME, threshold=BACKOFF_THRESHOLD, record_type="url"):
        return
    start = time.time()
    all_items: list[dict] = []
    all_urls: list[dict] = []
    error_msg: str | None = None
    status = "success"
    fetched = 0

    try:
        resp = conditional_get(FEED_NAME, FEED_URL)
        if resp.not_modified:
            logger.info("AUSTRAC: 304 Not Modified — skip")
        else:
            items = _parse_rss(resp.text)
            fetched = len(items)
            all_items.extend(items)
            for it in items:
                all_urls.extend(_extract_urls_from_body(it.get("body_md"), it["url"]))
            logger.info(f"AUSTRAC: {fetched} items")
    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"AUSTRAC fetch failed: {e}")

    with get_db() as conn:
        item_stats = (
            bulk_upsert_narrative_feed_items(conn, all_items, FEED_NAME)
            if all_items
            else {"new": 0, "updated": 0, "skipped": 0}
        )
        url_stats = (
            bulk_upsert_urls(conn, all_urls, FEED_NAME)
            if all_urls
            else {"new": 0, "updated": 0, "skipped": 0}
        )

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=fetched,
            records_new=item_stats["new"],
            records_updated=item_stats["updated"],
            records_skipped=item_stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="url",
        )
    logger.info(
        f"AUSTRAC complete: items new={item_stats['new']} updated={item_stats['updated']}, "
        f"urls new={url_stats['new']}, {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
