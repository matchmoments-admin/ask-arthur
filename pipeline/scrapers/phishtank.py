"""PhishTank CSV scraper — verified + online phishing URLs.

Data source: http://data.phishtank.com/data/online-valid.csv
Format: CSV with header row
Columns: phish_id, url, phish_detail_url, submission_time, verified, verified_time, online, target
"""

import csv
import io
import time

import requests

from common.backoff import enforce_backoff_or_skip
from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "phishtank"
CSV_URL = "http://data.phishtank.com/data/online-valid.csv"
# Higher threshold than the platform default (3) — PhishTank is high-volume
# with expected transient 5xx flaps; tripping at 3 would be too noisy.
BACKOFF_THRESHOLD = 5


def scrape() -> str:
    if enforce_backoff_or_skip(FEED_NAME, threshold=BACKOFF_THRESHOLD, record_type="url"):
        return "skipped"
    start = time.time()
    urls: list[dict] = []
    error_msg = None
    status = "success"

    try:
        logger.info(f"Fetching PhishTank CSV from {CSV_URL}")
        resp = requests.get(
            CSV_URL,
            timeout=120,
            headers={"User-Agent": "askarthur/pipeline (threat-intel)"},
        )
        resp.raise_for_status()

        reader = csv.DictReader(io.StringIO(resp.text))
        for row in reader:
            raw_url = row.get("url", "").strip()
            if not raw_url:
                continue

            target = row.get("target", "").strip()
            submission_time = row.get("submission_time", "").strip() or None
            detail_url = row.get("phish_detail_url", "").strip() or None
            urls.append(
                {
                    "url": raw_url,
                    "scam_type": "phishing",
                    "brand": target if target and target.lower() != "other" else None,
                    "feed_reported_at": submission_time,
                    "feed_reference_url": detail_url,
                }
            )

        logger.info(f"Parsed {len(urls)} verified URLs from PhishTank")

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"PhishTank fetch failed: {e}")

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
                logger.error(f"PhishTank upsert failed: {e}")
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
        f"PhishTank complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )

    return status


if __name__ == "__main__":
    import sys

    # Exit non-zero on a hard failure so the GitHub Actions notify-failure step
    # fires. "success"/"partial"/"skipped" all exit 0; only "error" exits 1.
    sys.exit(1 if scrape() == "error" else 0)
