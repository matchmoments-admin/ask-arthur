"""NVD (NIST National Vulnerability Database) recent-changes scraper.

Source: NVD CVE API 2.0 — https://services.nvd.nist.gov/rest/json/cves/2.0
License: Public domain (US government work)
Cadence: Weekly (Sunday 04:00 UTC) via .github/workflows/scrape-vulnerabilities.yml

Uses `lastModStartDate` not `pubStartDate` (per plan amendment #7) to catch CVSS
rescores on older CVEs — important because CISA's KEV additions often come after
the original publish date and re-trigger an NVD modification.

Auth: NVD_API_KEY env var gets a 10x throttle bump (50 req / 30s vs. 5 req / 30s
without a key). We sleep 0.6s between requests with a key, 6.0s without.

Pagination: startIndex + resultsPerPage (max 2000). Patch-Tuesday weeks can
exceed one page, so we loop until every result is fetched.
"""

import os
import time
from datetime import datetime, timedelta, timezone

import requests

from common.db import get_db
from common.logging_config import get_logger
from common.vuln_db import (
    bulk_upsert_vulnerabilities,
    fetch_epss_scores,
    log_vuln_ingestion,
    merge_external_references,
)

logger = get_logger(__name__)

FEED_NAME = "nvd_recent"
API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
LOOKBACK_DAYS = 7
RESULTS_PER_PAGE = 2000  # NVD hard cap
USER_AGENT = "AskArthur-VulnIntel/1.0 (+https://askarthur.au)"


def _sleep_for_rate_limit(has_api_key: bool) -> None:
    """NVD enforces 5 req / 30s without a key, 50 req / 30s with one.
    Ban for 15 min on 403. Sleep conservatively between each request."""
    time.sleep(0.6 if has_api_key else 6.0)


def _iso_z(dt: datetime) -> str:
    """Format datetime as the ISO8601 + 3-digit millis + Z that NVD expects."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _severity_from_cvss(score: float | None) -> str | None:
    """Translate a CVSS v3 base score to NVD's severity bucket."""
    if score is None:
        return None
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    if score > 0:
        return "low"
    return "none"


def _extract_cvss(metrics: dict) -> tuple[float | None, str | None]:
    """Pull a CVSS v3.1 / v3.0 base score + vector from NVD's metrics block.
    Falls back to v2 if no v3 present. Returns (score, vector) or (None, None)."""
    for key in ("cvssMetricV31", "cvssMetricV30"):
        entries = metrics.get(key) or []
        if entries:
            data = entries[0].get("cvssData") or {}
            score = data.get("baseScore")
            vector = data.get("vectorString")
            if score is not None:
                return float(score), vector
    entries = metrics.get("cvssMetricV2") or []
    if entries:
        data = entries[0].get("cvssData") or {}
        score = data.get("baseScore")
        vector = data.get("vectorString")
        if score is not None:
            return float(score), vector
    return None, None


def _categorize_cpe(cpes: list[str]) -> str:
    """Best-effort category mapping from CPE 2.3 uri strings.

    CPEs look like: cpe:2.3:a:vendor:product:version:...
    The 2nd field 'a' (application), 'o' (OS), 'h' (hardware) is useful but coarse.
    We also pattern-match vendor/product strings — same heuristic as cisa_kev.py
    for consistency across feeds.
    """
    joined = " ".join(cpes).lower()
    if any(x in joined for x in ["ivanti", "fortinet", "palo alto", "cisco", "citrix", "sonicwall", "f5", "juniper"]):
        return "network"
    if any(x in joined for x in ["chrome", "firefox", "safari", "edge_chromium", "microsoft_edge"]):
        return "browser"
    if any(x in joined for x in [":microsoft:windows", ":linux:linux_kernel", ":apple:macos", ":google:android", ":apple:iphone_os"]):
        return "os"
    if any(x in joined for x in ["apache:http_server", "nginx", "microsoft:iis", "apache:tomcat", "wordpress", "drupal", "joomla"]):
        return "web"
    if any(x in joined for x in [":amazon:", ":microsoft:azure", ":google:cloud", "kubernetes"]):
        return "cloud"
    if any(x in joined for x in ["openssl", "openssh", "libgcrypt"]):
        return "crypto"
    # CPE part code: 'a' app, 'o' os, 'h' hardware
    for cpe in cpes:
        parts = cpe.split(":")
        if len(parts) > 2:
            code = parts[2]
            if code == "o":
                return "os"
            if code == "h":
                return "infra"
    return "infra"


def _affected_products_from_config(configurations: list) -> list[str]:
    """Extract a flat list of CPE 2.3 vendor:product strings from a CVE's
    configurations block. We keep vendor:product to enable exposure matching
    against package.json / pyproject.toml down the line."""
    out: set[str] = set()
    for cfg in configurations or []:
        for node in cfg.get("nodes") or []:
            for cpe in node.get("cpeMatch") or []:
                criteria = cpe.get("criteria") or ""
                parts = criteria.split(":")
                if len(parts) >= 5:
                    vendor_product = f"{parts[3]}:{parts[4]}"
                    out.add(vendor_product)
    return sorted(out)


def _cpes_from_config(configurations: list) -> list[str]:
    """Flatten the configurations block into a simple list of CPE criteria
    strings (for category classification).
    """
    out: list[str] = []
    for cfg in configurations or []:
        for node in cfg.get("nodes") or []:
            for cpe in node.get("cpeMatch") or []:
                criteria = cpe.get("criteria")
                if criteria:
                    out.append(criteria)
    return out


def _english_description(descriptions: list) -> str | None:
    """Pick the English-language CVE description; NVD always provides one."""
    for d in descriptions or []:
        if d.get("lang") == "en":
            return d.get("value")
    return None


def _external_refs(cve: dict) -> list[dict]:
    """Build an external_references list from NVD's references block, plus
    a canonical link to the NVD detail page."""
    refs = [{"url": f"https://nvd.nist.gov/vuln/detail/{cve.get('id')}", "source": "nvd"}]
    for ref in cve.get("references") or []:
        url = ref.get("url")
        if not url:
            continue
        tags = ref.get("tags") or []
        if "Exploit" in tags:
            src = "nvd_exploit"
        elif "Patch" in tags:
            src = "nvd_patch"
        elif "Vendor Advisory" in tags:
            src = "nvd_vendor"
        else:
            src = "nvd_ref"
        refs.append({"url": url, "source": src})
    return refs


def _fetch_page(start_index: int, start_date: str, end_date: str, has_api_key: bool) -> dict:
    """Single paged request against the NVD 2.0 API."""
    headers = {"User-Agent": USER_AGENT}
    api_key = os.environ.get("NVD_API_KEY")
    if api_key:
        headers["apiKey"] = api_key

    params = {
        "lastModStartDate": start_date,
        "lastModEndDate": end_date,
        "startIndex": start_index,
        "resultsPerPage": RESULTS_PER_PAGE,
    }

    resp = requests.get(API_URL, headers=headers, params=params, timeout=90)
    if resp.status_code == 403:
        raise RuntimeError(
            "NVD returned 403 (rate limited or forbidden). "
            "Check NVD_API_KEY is set and valid. "
            "The 15-minute ban may now be in effect."
        )
    resp.raise_for_status()
    return resp.json()


def _parse_cve(cve_item: dict) -> dict | None:
    """Map one NVD CVE item to a bulk_upsert_vulnerabilities record dict."""
    cve = cve_item.get("cve") or {}
    cve_id = cve.get("id")
    if not cve_id:
        return None

    summary = _english_description(cve.get("descriptions", []))
    cpes = _cpes_from_config(cve.get("configurations", []))
    affected_products = _affected_products_from_config(cve.get("configurations", []))

    cvss_score, cvss_vector = _extract_cvss(cve.get("metrics") or {})
    severity = _severity_from_cvss(cvss_score)

    title = summary[:200] if summary else cve_id
    # vulnStatus: "Received" | "Awaiting Analysis" | "Undergoing Analysis" |
    # "Analyzed" | "Modified" | "Deferred" | "Rejected"
    vuln_status = (cve.get("vulnStatus") or "").lower()
    lifecycle_status = "disclosed"
    if vuln_status == "rejected":
        lifecycle_status = "rejected"
    elif vuln_status == "modified":
        lifecycle_status = "under_review"

    return {
        "identifier": cve_id,
        "identifier_type": "cve",
        "title": title,
        "summary": summary,
        "cvss_score": cvss_score,
        "cvss_vector": cvss_vector,
        "severity": severity,
        "published_at": cve.get("published"),
        "last_modified_at": cve.get("lastModified"),
        "affected_products": affected_products,
        "category": _categorize_cpe(cpes),
        "subcategory": (affected_products[0].split(":")[0] if affected_products else None),
        "tags": ["nvd"],
        "external_references": _external_refs(cve),
        "source_feeds": [FEED_NAME],
        "lifecycle_status": lifecycle_status,
    }


def scrape() -> None:
    start = time.time()
    records: list[dict] = []
    error_msg: str | None = None
    status = "success"

    now = datetime.now(timezone.utc)
    start_date = _iso_z(now - timedelta(days=LOOKBACK_DAYS))
    end_date = _iso_z(now)
    has_api_key = bool(os.environ.get("NVD_API_KEY"))
    if not has_api_key:
        logger.warning(
            "NVD_API_KEY not set — request rate limited to 5 req / 30s. "
            "Large catch-up windows may take a while."
        )

    try:
        logger.info(
            f"Fetching NVD CVEs modified between {start_date} and {end_date} "
            f"(API key: {'yes' if has_api_key else 'no'})"
        )
        start_index = 0
        total_results = None
        page_count = 0

        while True:
            page_count += 1
            if page_count > 1:
                _sleep_for_rate_limit(has_api_key)

            page = _fetch_page(start_index, start_date, end_date, has_api_key)
            if total_results is None:
                total_results = page.get("totalResults", 0)
                logger.info(f"NVD reports {total_results} modified CVEs in window")

            vulns = page.get("vulnerabilities") or []
            for item in vulns:
                parsed = _parse_cve(item)
                if parsed:
                    records.append(parsed)

            received = len(vulns)
            start_index += received
            if received == 0 or start_index >= (total_results or 0):
                break
            if page_count > 20:
                logger.warning(
                    f"NVD pagination exceeded 20 pages (startIndex={start_index}); "
                    "breaking out to avoid runaway loops"
                )
                break

        logger.info(f"Parsed {len(records)} NVD CVE entries across {page_count} page(s)")

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
        logger.error(f"NVD scrape failed: {e}")

    with get_db() as conn:
        upsert_stats = {"new": 0, "updated": 0, "skipped": 0}
        if records:
            try:
                # Merge external_references against existing rows so CISA's "notes"
                # url isn't lost when NVD re-modifies the same CVE.
                cursor = conn.cursor()
                identifiers = [r["identifier"] for r in records]
                cursor.execute(
                    "SELECT identifier, external_references FROM vulnerabilities WHERE identifier = ANY(%s)",
                    (identifiers,),
                )
                existing_refs = {row[0]: row[1] for row in cursor.fetchall()}
                cursor.close()
                for r in records:
                    r["external_references"] = merge_external_references(
                        existing_refs.get(r["identifier"]),
                        r["external_references"],
                    )

                upsert_stats = bulk_upsert_vulnerabilities(conn, records, FEED_NAME)
            except Exception as e:
                error_msg = str(e)
                status = "error"
                logger.error(f"NVD upsert failed: {e}")

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
        f"NVD scrape complete: {upsert_stats['new']} new, "
        f"{upsert_stats['updated']} updated, {upsert_stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
