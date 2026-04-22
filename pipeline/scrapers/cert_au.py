"""CERT Australia (ACSC) advisory feed scraper.

Data source: https://www.cyber.gov.au/api/v1/advisories
Format: JSON API — Australian Cyber Security Centre advisories
License: CC BY 4.0

Extracts cybersecurity advisories from ACSC (the Australian government CERT).
These are high-quality, manually-curated threat alerts.

Two entry points:
- `scrape()` — the original URL-based scrape that populates the `urls` table
  for site-audit / scan-and-verify. Preserved for backwards compatibility.
- `scrape_vulnerabilities()` — Sprint 2 addition. Parses CVE identifiers out of
  ACSC advisory titles + descriptions and upserts into `vulnerabilities` with
  `au_context.gov_affected = true` + `au_context.source = 'cert_au_advisory'`.
  This lets the AU enrichment Inngest function (PR B2) skip the Claude call
  for ACSC-curated advisories — we already know they're Australia-relevant.
"""

import re
import time
from datetime import datetime, timezone

import requests

from common.db import get_db, bulk_upsert_urls, log_ingestion
from common.logging_config import get_logger
from common.vuln_db import (
    bulk_upsert_vulnerabilities,
    fetch_epss_scores,
    log_vuln_ingestion,
    merge_external_references,
)

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


VULN_FEED_NAME = "cert_au_vulns"
CVE_RE = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.IGNORECASE)


def _classify_category(text: str) -> str:
    """Category heuristic for vulnerabilities extracted from ACSC advisories.
    Kept lightweight — ACSC advisories are often mixed-subject, so we bias
    toward 'infra' as a safe default."""
    t = text.lower()
    if any(x in t for x in ["ivanti", "fortinet", "palo alto", "cisco", "citrix", "sonicwall"]):
        return "network"
    if any(x in t for x in ["chrome", "firefox", "safari", "edge"]):
        return "browser"
    if any(x in t for x in ["windows", "linux", "macos", "android", "ios"]):
        return "os"
    if any(x in t for x in ["apache", "nginx", "wordpress", "drupal"]):
        return "web"
    if any(x in t for x in ["aws", "azure", "gcp", "kubernetes"]):
        return "cloud"
    return "infra"


def _severity_from_text(text: str) -> str | None:
    """ACSC grades advisories Critical/High/Medium/Low in its own schema.
    We try title-match first; else None (vulnerabilities table accepts NULL)."""
    t = text.lower()
    if "critical" in t:
        return "critical"
    if "high severity" in t or "high-severity" in t:
        return "high"
    if "medium severity" in t:
        return "medium"
    if "low severity" in t:
        return "low"
    return None


def scrape_vulnerabilities() -> None:
    """Fetch ACSC advisories and extract CVE-referenced vulnerabilities.

    The same JSON API feeds both scrape() and this function; we call
    _fetch_json_api_raw() to avoid re-deriving scam_type fields we don't need
    here. If the API call fails, we log a skipped run and exit cleanly — the
    CISA/NVD/GHSA scrapers still run and the workflow stays green.
    """
    start = time.time()
    records: list[dict] = []
    error_msg: str | None = None
    status = "success"

    try:
        logger.info(f"Fetching CERT AU advisories (for vuln extraction) from {FEED_URL}")
        resp = requests.get(
            FEED_URL,
            timeout=60,
            headers={"User-Agent": "AskArthur-VulnIntel/1.0 (+https://askarthur.au)"},
            params={"limit": "50", "sort": "-date"},
        )
        resp.raise_for_status()
        data = resp.json()
        advisories = data if isinstance(data, list) else data.get("data", data.get("results", []))

        for advisory in advisories:
            title = advisory.get("title", "") or ""
            description = advisory.get("description", "") or ""
            body = f"{title}\n\n{description}"
            url = advisory.get("url") or advisory.get("link") or (
                f"https://www.cyber.gov.au/about-us/advisories/{advisory.get('id') or advisory.get('slug')}"
                if (advisory.get('id') or advisory.get('slug')) else None
            )
            published = advisory.get("date") or advisory.get("published_at")
            if isinstance(published, (int, float)):
                published = datetime.fromtimestamp(published, tz=timezone.utc).isoformat()

            cves = set(m.group(0).upper() for m in CVE_RE.finditer(body))
            for cve in cves:
                refs = [{"url": f"https://nvd.nist.gov/vuln/detail/{cve}", "source": "nvd"}]
                if url:
                    refs.append({"url": url, "source": "cert_au_advisory"})

                records.append({
                    "identifier": cve,
                    "identifier_type": "cve",
                    "title": title[:200] or cve,
                    "summary": description or None,
                    "severity": _severity_from_text(body),
                    "published_at": published,
                    "last_modified_at": published,
                    "affected_products": [],
                    "category": _classify_category(body),
                    "subcategory": "cert_au",
                    "tags": ["cert_au_advisory", "au_gov"],
                    "external_references": refs,
                    "au_context": {
                        "gov_affected": True,
                        "source": "cert_au_advisory",
                    },
                    "source_feeds": [VULN_FEED_NAME],
                })

        logger.info(
            f"Extracted {len(records)} CVE references from "
            f"{len(advisories)} ACSC advisories"
        )

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
        logger.error(f"CERT AU vuln extraction failed: {e}")

    with get_db() as conn:
        upsert_stats = {"new": 0, "updated": 0, "skipped": 0}
        if records:
            try:
                cursor = conn.cursor()
                identifiers = [r["identifier"] for r in records]
                cursor.execute(
                    "SELECT identifier, external_references, au_context "
                    "FROM vulnerabilities WHERE identifier = ANY(%s)",
                    (identifiers,),
                )
                existing = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
                cursor.close()
                for r in records:
                    row = existing.get(r["identifier"])
                    if row:
                        r["external_references"] = merge_external_references(
                            row[0], r["external_references"]
                        )
                        # Merge au_context — preserve Claude-enriched bank list etc.
                        existing_ctx = row[1] if isinstance(row[1], dict) else {}
                        merged_ctx = {**existing_ctx, **r["au_context"]}
                        r["au_context"] = merged_ctx

                upsert_stats = bulk_upsert_vulnerabilities(conn, records, VULN_FEED_NAME)
            except Exception as e:
                error_msg = str(e)
                status = "error"
                logger.error(f"CERT AU vuln upsert failed: {e}")

        duration_ms = int((time.time() - start) * 1000)
        log_vuln_ingestion(
            conn,
            feed_name=VULN_FEED_NAME,
            status=status,
            records_fetched=len(records),
            records_new=upsert_stats["new"],
            records_updated=upsert_stats["updated"],
            records_skipped=upsert_stats["skipped"],
            duration_ms=duration_ms,
            error_message=error_msg,
        )

    logger.info(
        f"CERT AU vuln scrape complete: {upsert_stats['new']} new, "
        f"{upsert_stats['updated']} updated, {upsert_stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
