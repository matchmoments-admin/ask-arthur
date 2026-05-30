"""ACSC consumer alerts + advisories — narrative-shape scraper.

Source:
  https://www.cyber.gov.au/rss/alerts
  https://www.cyber.gov.au/rss/advisories

Cadence: 3-hourly (AU regulator narrative latency target).
License: Crown copyright, CC BY 4.0. Attribute "Source: ASD ACSC".

Distinct from cert_au.py — that scraper consumes the JSON CVE API for the
vulnerability pipeline. This one writes consumer-facing alerts/advisories
to feed_items so they show up on /scam-feed and the weekly digest.
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
from common.normalize import normalize_url

logger = get_logger(__name__)

FEED_NAME = "acsc"
FEEDS = {
    "alerts": "https://www.cyber.gov.au/rss/alerts",
    "advisories": "https://www.cyber.gov.au/rss/advisories",
}

URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def _hash_external_id(link: str) -> str:
    return hashlib.sha256(link.encode("utf-8")).hexdigest()[:32]


def _parse_rss(xml_text: str, kind: str) -> list[dict]:
    """Parse RSS into normalised dicts. Empty list on parse error."""
    items: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        logger.error(f"ACSC {kind} RSS parse failed: {e}")
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
        # ACSC tags advisories with multiple <category> elements.
        tags = [
            (c.text or "").strip()
            for c in it.findall("category")
            if (c.text or "").strip()
        ]

        items.append({
            "source": "acsc",
            "external_id": _hash_external_id(link),
            "title": title,
            "description": description[:2000] if description else None,
            "body_md": description or None,
            "url": link,
            "source_url": link,
            "category": _infer_category(title, description),
            "country_code": "AU",
            "tags": tags + [kind],
            "published_at": pub_date,
            "source_created_at": pub_date,
            "provenance_tier": "tier_1_regulator",
        })
    return items


def _infer_category(title: str, description: str) -> str:
    text = f"{title} {description}".lower()
    if any(w in text for w in ("phish", "fake email", "fake sms")):
        return "phishing"
    if any(w in text for w in ("ransom", "malware", "trojan")):
        return "other"
    if any(w in text for w in ("scam", "fraud", "impersonat")):
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


BACKOFF_THRESHOLD = 3  # cyber.gov.au is the most-blocked upstream we have


def scrape() -> str:
    if enforce_backoff_or_skip(FEED_NAME, threshold=BACKOFF_THRESHOLD, record_type="url"):
        return "skipped"
    start = time.time()
    all_items: list[dict] = []
    all_urls: list[dict] = []
    error_msg: str | None = None
    status = "success"
    fetched = 0

    try:
        for kind, url in FEEDS.items():
            resp = conditional_get(FEED_NAME, url)
            if resp.not_modified:
                logger.info(f"ACSC {kind}: 304 Not Modified — skip")
                continue
            items = _parse_rss(resp.text, kind)
            fetched += len(items)
            all_items.extend(items)
            for it in items:
                all_urls.extend(_extract_urls_from_body(it.get("body_md"), it["url"]))
        logger.info(f"ACSC: {fetched} items across {len(FEEDS)} feeds")
    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"ACSC fetch failed: {e}")

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
        f"ACSC complete: items new={item_stats['new']} updated={item_stats['updated']}, "
        f"urls new={url_stats['new']}, {duration_ms}ms"
    )

    return status


if __name__ == "__main__":
    import sys

    # Exit non-zero on a hard failure so the GitHub Actions notify-failure step
    # fires. "success"/"partial"/"skipped" all exit 0; only "error" exits 1.
    sys.exit(1 if scrape() == "error" else 0)
