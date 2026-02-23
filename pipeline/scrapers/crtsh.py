"""crt.sh Certificate Transparency scraper — AU brand keyword monitoring.

Data source: https://crt.sh/?q=%25{keyword}%25&output=json
Monitors CT logs for certificates matching Australian brand keywords,
filters out legitimate domains, tags as brand_impersonation.

NOTE: crt.sh is a free service backed by a single PostgreSQL instance.
It's notoriously unreliable under load — we use exponential backoff retries.
"""

import time
from urllib.parse import quote

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger

logger = get_logger(__name__)

FEED_NAME = "crtsh"

# Australian brands to monitor in CT logs
AU_BRAND_KEYWORDS = [
    "mygov",
    "centrelink",
    "ato.gov",
    "medicare",
    "auspost",
    "commbank",
    "nab",
    "anz",
    "westpac",
    "telstra",
    "nbn",
    "optus",
    "woolworths",
    "coles",
    "servicensw",
]

# Legitimate domains to exclude — these are the real brand domains
LEGITIMATE_DOMAINS = frozenset(
    [
        "my.gov.au",
        "mygov.au",
        "humanservices.gov.au",
        "servicesaustralia.gov.au",
        "centrelink.gov.au",
        "ato.gov.au",
        "medicare.gov.au",
        "auspost.com.au",
        "commbank.com.au",
        "nab.com.au",
        "anz.com",
        "anz.com.au",
        "westpac.com.au",
        "telstra.com",
        "telstra.com.au",
        "nbnco.com.au",
        "optus.com.au",
        "woolworths.com.au",
        "coles.com.au",
        "service.nsw.gov.au",
        # Common CDN/infra domains used by these brands
        "cloudfront.net",
        "amazonaws.com",
        "akamaized.net",
        "azureedge.net",
    ]
)

# Max retries for crt.sh (exponential backoff)
MAX_RETRIES = 3
BASE_DELAY = 2  # seconds


def _fetch_crtsh(keyword: str) -> list[dict]:
    """Fetch certificates from crt.sh for a keyword with exponential backoff."""
    url = f"https://crt.sh/?q=%25{quote(keyword)}%25&output=json"

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, timeout=30)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (502, 503, 504):
                # Server overloaded — back off
                delay = BASE_DELAY * (2**attempt)
                logger.warning(
                    f"crt.sh returned {resp.status_code} for '{keyword}', "
                    f"retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})"
                )
                time.sleep(delay)
                continue
            resp.raise_for_status()
        except requests.exceptions.Timeout:
            delay = BASE_DELAY * (2**attempt)
            logger.warning(
                f"crt.sh timeout for '{keyword}', "
                f"retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})"
            )
            time.sleep(delay)
        except requests.exceptions.ConnectionError:
            delay = BASE_DELAY * (2**attempt)
            logger.warning(
                f"crt.sh connection error for '{keyword}', "
                f"retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})"
            )
            time.sleep(delay)
        except Exception as e:
            logger.error(f"crt.sh unexpected error for '{keyword}': {e}")
            return []

    logger.error(f"crt.sh failed after {MAX_RETRIES} retries for '{keyword}'")
    return []


def is_legitimate_domain(domain: str) -> bool:
    """Check if a domain is a known legitimate brand domain."""
    domain = domain.lower().strip().rstrip(".")
    for legit in LEGITIMATE_DOMAINS:
        if domain == legit or domain.endswith(f".{legit}"):
            return True
    return False


def scrape() -> None:
    start = time.time()
    urls: list[dict] = []
    seen_domains: set[str] = set()
    error_msg = None
    status = "success"

    try:
        for keyword in AU_BRAND_KEYWORDS:
            certs = _fetch_crtsh(keyword)
            if not certs:
                continue

            for cert in certs:
                common_name = cert.get("common_name", "").strip().lower()
                if not common_name or common_name.startswith("*"):
                    # Skip wildcards — too noisy
                    continue

                # Skip legitimate domains
                if is_legitimate_domain(common_name):
                    continue

                # Deduplicate within this run
                if common_name in seen_domains:
                    continue
                seen_domains.add(common_name)

                not_before = cert.get("not_before", "").strip() or None
                cert_id = cert.get("id")
                ref_url = f"https://crt.sh/?id={cert_id}" if cert_id else None
                urls.append(
                    {
                        "url": f"https://{common_name}",
                        "scam_type": "brand_impersonation",
                        "brand": keyword,
                        "feed_reported_at": not_before,
                        "feed_reference_url": ref_url,
                    }
                )

            # Rate-limit between keywords to be kind to crt.sh
            time.sleep(1)

        logger.info(
            f"Found {len(urls)} suspicious domains across {len(AU_BRAND_KEYWORDS)} keywords"
        )

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"crt.sh scrape failed: {e}")

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
                logger.error(f"crt.sh upsert failed: {e}")
        else:
            stats = {"new": 0, "updated": 0, "skipped": 0}

        duration_ms = int((time.time() - start) * 1000)
        log_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            urls_fetched=len(urls),
            urls_new=stats["new"],
            urls_updated=stats["updated"],
            urls_skipped=stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
        )

    logger.info(
        f"crt.sh complete: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
