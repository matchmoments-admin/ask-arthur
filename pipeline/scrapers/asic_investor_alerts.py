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
    bulk_upsert_asic_alerts,
    bulk_upsert_narrative_feed_items,
    bulk_upsert_urls,
    deactivate_stale_asic_alerts,
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

    for key in ("websites", "otherInformationSocialAccount"):
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


def _alias_list(record: dict) -> list[str]:
    """Pull alias/other-name strings out of a record (list or delimited string).

    ASIC's Moneysmart JSON carries these under `otherInformationAliases`
    (verified against the live feed 2026-07-21) — a list of company/trading-name
    strings. Fall back to a delimited string form defensively.
    """
    val = record.get("otherInformationAliases")
    if isinstance(val, list):
        return [str(v).strip() for v in val if str(v).strip()]
    if isinstance(val, str):
        return [p.strip() for p in re.split(r"[,\n;]+", val) if p.strip()]
    return []


def _alert_type(record: dict) -> str | None:
    """ASIC's classification (e.g. 'Unlicensed', 'Imposter', 'Unlicensed (Legacy)').

    Lives under `investorAlertCategoryMandatory` in the live feed.
    """
    v = record.get("investorAlertCategoryMandatory")
    return v.strip() if isinstance(v, str) and v.strip() else None


def _should_prune(alerts: list[dict], status: str) -> bool:
    """Only prune (soft-delist) on a real, non-empty snapshot.

    Guards the register against being wiped on a 304 (alerts empty), a failed
    fetch (status != 'success'), or a valid-but-empty [] JSON (alerts empty).
    A count-floor check (in scrape()) additionally guards a truncated 200.
    """
    return bool(alerts) and status == "success"


def _build_alert(record: dict, domains: list[str], snapshot_date: str) -> dict | None:
    """Shape one ASIC record into an asic_investor_alerts upsert row.

    Returns None when the record has no entity name (nothing to key on).
    ASIC's entity name lives under `nameMandatory` (verified against the live
    feed 2026-07-21 — all 4,212 records carry it).
    """
    entity_name = (record.get("nameMandatory") or "").strip()
    if not entity_name:
        return None
    return {
        "entity_name": entity_name,
        "aliases": _alias_list(record),
        "domains": domains,
        "alert_type": _alert_type(record),
        "asic_url": SOURCE_PAGE,
        "snapshot_date": snapshot_date,
        "raw": record,
    }


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
    alerts: list[dict] = []
    snapshot_date = time.strftime("%Y-%m-%d", time.gmtime())

    try:
        resp = conditional_get(FEED_NAME, JSON_URL, timeout=60)
        if resp.not_modified:
            logger.info("ASIC: 304 Not Modified — skip")
        else:
            payload = json.loads(resp.text)
            records = _records_from_payload(payload)
            logger.info(f"ASIC: parsed {len(records)} entity records")

            for r in records:
                record_domains: list[str] = []
                for raw_url in _flatten_urls(r):
                    norm = normalize_url(raw_url)
                    if norm is None:
                        continue
                    all_urls.append({
                        "url": raw_url,
                        "scam_type": "investment_fraud",
                        "brand": (r.get("nameMandatory") or "").strip() or None,
                        "feed_reference_url": SOURCE_PAGE,
                        "country_code": "AU",
                    })
                    if norm.domain and norm.domain not in record_domains:
                        record_domains.append(norm.domain)

                alert = _build_alert(r, record_domains, snapshot_date)
                if alert:
                    alerts.append(alert)

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
        alert_stats = (
            bulk_upsert_asic_alerts(conn, alerts, FEED_NAME)
            if alerts
            else {"new": 0, "updated": 0, "skipped": 0}
        )
        # Prune (soft-delist) only on a real snapshot — never on a 304 / failed
        # fetch / empty payload (guarded by _should_prune), and never when
        # today's snapshot is suspiciously small vs the active set (guards a
        # truncated 200 response, and rows whose individual upsert failed and
        # kept a stale snapshot_date). Both delistings self-heal next run.
        if _should_prune(alerts, status):
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT count(*) FROM public.asic_investor_alerts WHERE is_active"
                )
                active_count = cur.fetchone()[0] or 0
            if active_count == 0 or len(alerts) >= active_count * 0.5:
                deactivate_stale_asic_alerts(conn, snapshot_date)
            else:
                logger.warning(
                    f"ASIC prune skipped: {len(alerts)} entities < 50% of "
                    f"{active_count} active — possible partial response",
                    extra={"metadata": {"feed": FEED_NAME}},
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
        f"updated={url_stats['updated']}, entities new={alert_stats['new']} "
        f"updated={alert_stats['updated']}, summary new={feed_stats['new']} "
        f"in {duration_ms}ms"
    )

    return status


if __name__ == "__main__":
    import sys

    # Exit non-zero on a hard failure so the GitHub Actions notify-failure step
    # fires. "success"/"partial"/"skipped" all exit 0; only "error" exits 1.
    sys.exit(1 if scrape() == "error" else 0)
