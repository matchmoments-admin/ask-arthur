"""CISA Known Exploited Vulnerabilities catalog scraper.

Source: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
License: Public domain
Cadence: Weekly (Sunday 04:00 UTC) via .github/workflows/scrape-vulnerabilities.yml
"""

import time

import requests

from common.db import get_db
from common.logging_config import get_logger
from common.vuln_db import (
    bulk_upsert_vulnerabilities,
    fetch_epss_scores,
    log_vuln_ingestion,
)

logger = get_logger(__name__)

FEED_NAME = "cisa_kev"
API_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"


def _categorize(vendor: str, product: str) -> str:
    """Map CISA vendor/product to a v63 vulnerabilities.category value."""
    v = (vendor + " " + product).lower()
    if any(x in v for x in ["ivanti", "fortinet", "palo alto", "cisco", "citrix", "sonicwall", "f5", "juniper"]):
        return "network"
    if any(x in v for x in ["chrome", "firefox", "safari", "edge"]):
        return "browser"
    if any(x in v for x in ["windows", "linux", "macos", "android", "ios"]):
        return "os"
    if any(x in v for x in ["apache", "nginx", "iis", "tomcat", "wordpress", "drupal", "joomla"]):
        return "web"
    if any(x in v for x in ["aws", "azure", "gcp", "google cloud", "kubernetes"]):
        return "cloud"
    if any(x in v for x in ["openssl", "openssh"]):
        return "crypto"
    return "infra"


def _to_iso(date_str: str | None) -> str | None:
    """CISA dates are YYYY-MM-DD; postgres takes them as timestamptz at midnight UTC."""
    if not date_str:
        return None
    return f"{date_str}T00:00:00Z" if "T" not in date_str else date_str


def scrape() -> None:
    start = time.time()
    records: list[dict] = []
    error_msg: str | None = None
    status = "success"

    try:
        logger.info(f"Fetching CISA KEV catalog from {API_URL}")
        resp = requests.get(API_URL, timeout=60, headers={
            "User-Agent": "AskArthur-VulnIntel/1.0 (+https://askarthur.au)"
        })
        resp.raise_for_status()
        data = resp.json()

        for vuln in data.get("vulnerabilities", []):
            cve = vuln.get("cveID")
            if not cve:
                continue
            vendor = vuln.get("vendorProject", "") or ""
            product = vuln.get("product", "") or ""
            date_added = vuln.get("dateAdded")
            notes_url = vuln.get("notes") or None
            external_refs = []
            if notes_url:
                external_refs.append({"url": notes_url, "source": "cisa_kev_notes"})
            external_refs.append({
                "url": f"https://nvd.nist.gov/vuln/detail/{cve}",
                "source": "nvd",
            })

            records.append({
                "identifier": cve,
                "identifier_type": "cve",
                "title": vuln.get("vulnerabilityName") or f"{vendor} {product}".strip(),
                "summary": vuln.get("shortDescription"),
                "severity": "critical",  # KEV by definition is exploited; treat as critical for triage
                "published_at": _to_iso(date_added),
                "last_modified_at": _to_iso(date_added),
                "affected_products": [product] if product else [vendor] if vendor else [],
                "category": _categorize(vendor, product),
                "subcategory": vendor or None,
                "tags": ["cisa_kev", vendor.lower().replace(" ", "_")] if vendor else ["cisa_kev"],
                "external_references": external_refs,
                "exploit_available": True,
                "exploited_in_wild": True,
                "cisa_kev": True,
                "cisa_kev_added_at": _to_iso(date_added),
                "source_feeds": [FEED_NAME],
            })

        logger.info(f"Parsed {len(records)} CISA KEV entries")

        # EPSS enrichment — populate the per-CVE exploitation probability so the
        # admin dashboard can sort by "most likely to be exploited next 30 days".
        # Failures here are non-fatal; missing scores stay NULL in the DB.
        if records:
            epss_map = fetch_epss_scores(r["identifier"] for r in records)
            for r in records:
                hit = epss_map.get(r["identifier"])
                if hit:
                    r["epss_score"] = hit[0]
                    r["epss_percentile"] = hit[1]

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"CISA KEV fetch failed: {e}")

    with get_db() as conn:
        upsert_stats = {"new": 0, "updated": 0, "skipped": 0}
        if records:
            try:
                upsert_stats = bulk_upsert_vulnerabilities(conn, records, FEED_NAME)
            except Exception as e:
                error_msg = str(e)
                status = "error"
                logger.error(f"CISA KEV upsert failed: {e}")

        duration_ms = int((time.time() - start) * 1000)
        log_vuln_ingestion(
            conn,
            feed_name=FEED_NAME,
            status=status,
            records_fetched=len(records),
            records_new=upsert_stats["new"],
            records_updated=upsert_stats["updated"],
            records_skipped=upsert_stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
        )

    logger.info(
        f"CISA KEV complete: {upsert_stats['new']} new, "
        f"{upsert_stats['updated']} updated, {upsert_stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
