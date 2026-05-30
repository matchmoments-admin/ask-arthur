"""ASIC Moneysmart Investor Alert List — JSON snapshot scraper.

Source: https://static.moneysmart.gov.au/_data/investor-alert-list.json
  (URL discovered by scraping the page at
   https://moneysmart.gov.au/check-and-report-scams/investor-alert-list).

Cadence: daily. The list is regulator-confirmed (entities ASIC has flagged
as unlicensed or impersonating licensed firms) — the highest-quality
Australian IOC source we ingest.

License: CC BY 4.0 (Australian Government open data). Attribute "Source: ASIC".
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

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

FEED_NAME = "asic_investor"
JSON_URL = "https://static.moneysmart.gov.au/_data/investor-alert-list.json"
SOURCE_PAGE = "https://moneysmart.gov.au/check-and-report-scams/investor-alert-list"
BACKOFF_THRESHOLD = 3

# Liberal URL extractor — ASIC packs websites/aliases as plain strings or
# multi-line text. We split on commas/newlines/whitespace then validate.
URL_TOKEN = re.compile(r"https?://[^\s,;]+", re.IGNORECASE)


def _flatten_urls(record: dict) -> list[str]:
    """Pull every plausible URL/website out of a record's text fields."""
    found: list[str] = []
    seen: set[str] = set()

    def _add(candidate: str) -> None:
        c = candidate.strip().rstrip(".,);:'\"")
        if not c:
            return
        # Domains without scheme — common in the dataset.
        if "://" not in c:
            if "." not in c or " " in c:
                return
            c = "http://" + c
        if c in seen:
            return
        seen.add(c)
        found.append(c)

    for key in ("website", "websites", "url", "urls", "aliases", "name", "details"):
        val = record.get(key)
        if val is None:
            continue
        if isinstance(val, list):
            for v in val:
                if isinstance(v, str):
                    if URL_TOKEN.search(v):
                        for m in URL_TOKEN.findall(v):
                            _add(m)
                    else:
                        _add(v)
        elif isinstance(val, str):
            for m in URL_TOKEN.findall(val):
                _add(m)
            # Also try the raw value in case it's a bare domain.
            if " " not in val and "." in val and "://" not in val:
                _add(val)
    return found


def _build_synthetic_summary(records: list[dict]) -> dict | None:
    """One narrative feed_item per ingestion run summarising the diff.

    Lets the weekly digest say "ASIC added 7 entities this week" without
    rendering individual entity rows, which would crowd the email.
    """
    if not records:
        return None
    snapshot_id = time.strftime("snapshot-%Y-%m-%d", time.gmtime())
    title = f"ASIC Investor Alert List — {len(records)} flagged entities"
    body_parts = [
        f"# ASIC Investor Alert List snapshot",
        "",
        f"Today's snapshot lists **{len(records)}** unlicensed or impersonating "
        "entities currently flagged by ASIC. The list updates continuously; "
        "this digest captures the latest state.",
        "",
        f"Source: <{SOURCE_PAGE}>",
    ]
    return {
        "source": "asic_investor",
        "external_id": snapshot_id,
        "title": title,
        "description": title,
        "body_md": "\n".join(body_parts),
        "url": SOURCE_PAGE,
        "source_url": SOURCE_PAGE,
        "category": "investment_fraud",
        "country_code": "AU",
        "tags": ["asic", "investor-alert", "regulator-confirmed"],
        "published_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "provenance_tier": "tier_1_regulator",
    }


def _records_from_payload(payload: Any) -> list[dict]:
    """The JSON shape isn't documented; tolerate list, {records: [...]},
    or {data: [...]}."""
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("records", "data", "items", "entities"):
            v = payload.get(key)
            if isinstance(v, list):
                return [r for r in v if isinstance(r, dict)]
    return []


def scrape() -> str:
    if enforce_backoff_or_skip(FEED_NAME, threshold=BACKOFF_THRESHOLD, record_type="url"):
        return "skipped"
    start = time.time()
    error_msg: str | None = None
    status = "success"
    records: list[dict] = []
    all_urls: list[dict] = []
    feed_items: list[dict] = []

    try:
        resp = conditional_get(FEED_NAME, JSON_URL, timeout=60)
        if resp.not_modified:
            logger.info("ASIC: 304 Not Modified — skip")
        else:
            payload = json.loads(resp.text)
            records = _records_from_payload(payload)
            logger.info(f"ASIC: parsed {len(records)} entity records")

            for r in records:
                for raw_url in _flatten_urls(r):
                    norm = normalize_url(raw_url)
                    if norm is None:
                        continue
                    all_urls.append({
                        "url": raw_url,
                        "scam_type": "investment_fraud",
                        "brand": (r.get("name") or "").strip() or None,
                        "feed_reference_url": SOURCE_PAGE,
                        "country_code": "AU",
                    })

            summary = _build_synthetic_summary(records)
            if summary:
                feed_items.append(summary)
    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"ASIC fetch failed: {e}")

    with get_db() as conn:
        url_stats = (
            bulk_upsert_urls(conn, all_urls, FEED_NAME)
            if all_urls
            else {"new": 0, "updated": 0, "skipped": 0}
        )
        feed_stats = (
            bulk_upsert_narrative_feed_items(conn, feed_items, FEED_NAME)
            if feed_items
            else {"new": 0, "updated": 0, "skipped": 0}
        )
        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=len(records),
            records_new=url_stats["new"],
            records_updated=url_stats["updated"],
            records_skipped=url_stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
            record_type="url",
        )
    logger.info(
        f"ASIC complete: {len(records)} records, urls new={url_stats['new']} "
        f"updated={url_stats['updated']}, summary new={feed_stats['new']} in {duration_ms}ms"
    )

    return status


if __name__ == "__main__":
    import sys

    # Exit non-zero on a hard failure so the GitHub Actions notify-failure step
    # fires. "success"/"partial"/"skipped" all exit 0; only "error" exits 1.
    sys.exit(1 if scrape() == "error" else 0)
