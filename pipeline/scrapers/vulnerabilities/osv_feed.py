"""OSV.dev (Open Source Vulnerabilities) per-ecosystem scraper.

Source: OSV.dev — https://osv.dev/
License: CC-BY 4.0 (https://osv.dev/terms)
Cadence: Weekly (Sunday 04:00 UTC) via .github/workflows/scrape-vulnerabilities.yml

OSV aggregates advisories from npm, pypi, rubygems, crates.io, nuget, and more.
It's often faster than NVD at picking up ecosystem-specific issues (published
the same day as the package maintainer tags a release). Many records overlap
with GHSA/NVD; bulk_upsert_vulnerabilities + merge_external_references dedup
correctly via `identifier` conflict.

This is a light-weight scraper that hits the public zip bundles for npm + pypi
only. Rubygems/crates/nuget are deferred until a user reports exposure.

Auth: none required. Rate limit is generous (bundle downloads are S3-backed).
"""

import io
import json
import time
import zipfile
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

FEED_NAME = "osv_feed"
LOOKBACK_DAYS = 7
USER_AGENT = "AskArthur-VulnIntel/1.0 (+https://askarthur.au)"

# OSV provides per-ecosystem zip archives. We pick the two most relevant.
ECOSYSTEMS = {
    "npm": "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip",
    "pypi": "https://osv-vulnerabilities.storage.googleapis.com/PyPI/all.zip",
}


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # OSV uses RFC3339 / ISO8601 (Z-suffixed UTC)
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _pick_cve(aliases: list[str] | None) -> str | None:
    """OSV records list aliases (CVE-*, GHSA-*, etc). Prefer CVE for dedup."""
    for a in aliases or []:
        if a.startswith("CVE-"):
            return a
    return None


def _severity_from_osv(record: dict) -> tuple[str | None, float | None, str | None]:
    """OSV severity is usually a list of {type: CVSS_V3, score: vector}.
    Translate to (severity_label, cvss_score, cvss_vector)."""
    severities = record.get("severity") or []
    cvss_vector: str | None = None
    for s in severities:
        if s.get("type", "").upper().startswith("CVSS"):
            cvss_vector = s.get("score")
            break
    if not cvss_vector:
        return None, None, None

    # Parse base score out of a CVSS vector string like
    # "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" — no score embedded; we'd
    # have to compute, which is non-trivial. So we leave cvss_score as None and
    # derive severity label from CVSS vector if possible; else None.
    severity = None
    if "/AV:N/" in cvss_vector and "/AC:L/" in cvss_vector and "/I:H/" in cvss_vector:
        severity = "high"
    return severity, None, cvss_vector


def _category_for_ecosystem(ecosystem: str) -> str:
    e = ecosystem.lower()
    if e == "npm":
        return "web"
    return "software"


def _parse_record(rec: dict, ecosystem: str) -> dict | None:
    osv_id = rec.get("id")
    if not osv_id:
        return None

    aliases = rec.get("aliases") or []
    cve_id = _pick_cve(aliases)
    identifier = cve_id or osv_id
    identifier_type = "cve" if cve_id else ("ghsa" if osv_id.startswith("GHSA-") else "custom")

    affected = rec.get("affected") or []
    affected_products = sorted({
        f"{ecosystem.lower()}:{a.get('package', {}).get('name', '')}"
        for a in affected
        if a.get("package")
    })
    patched_versions: list[str] = []
    for a in affected:
        for r in a.get("ranges") or []:
            for ev in r.get("events") or []:
                fixed = ev.get("fixed")
                if fixed:
                    patched_versions.append(fixed)

    severity, cvss_score, cvss_vector = _severity_from_osv(rec)

    refs = [{"url": f"https://osv.dev/vulnerability/{osv_id}", "source": "osv"}]
    if cve_id:
        refs.append({"url": f"https://nvd.nist.gov/vuln/detail/{cve_id}", "source": "nvd"})
    for ref in rec.get("references") or []:
        url = ref.get("url")
        if url:
            refs.append({"url": url, "source": f"osv_{ref.get('type', 'ref').lower()}"})

    lifecycle_status = "withdrawn" if rec.get("withdrawn") else "disclosed"

    summary = rec.get("summary") or ""
    details = rec.get("details")
    title = summary[:200] if summary else osv_id

    return {
        "identifier": identifier,
        "identifier_type": identifier_type,
        "title": title,
        "summary": details or summary,
        "cvss_score": cvss_score,
        "cvss_vector": cvss_vector,
        "severity": severity,
        "published_at": rec.get("published"),
        "last_modified_at": rec.get("modified"),
        "affected_products": affected_products,
        "category": _category_for_ecosystem(ecosystem),
        "subcategory": ecosystem.lower(),
        "tags": ["osv", ecosystem.lower()],
        "external_references": refs,
        "source_feeds": [FEED_NAME],
        "patched_in_versions": patched_versions,
        "lifecycle_status": lifecycle_status,
    }


def _iter_recent_records(ecosystem: str, zip_url: str, since: datetime):
    """Download the ecosystem zip, yield records modified since `since`.
    Streams the zip in memory — each file (~500KB compressed, ~1-5MB expanded)
    is well within the runner's limits."""
    logger.info(f"  downloading {ecosystem} zip from {zip_url}")
    resp = requests.get(zip_url, headers={"User-Agent": USER_AGENT}, timeout=120, stream=True)
    resp.raise_for_status()
    buf = io.BytesIO(resp.content)
    with zipfile.ZipFile(buf) as zf:
        names = zf.namelist()
        logger.info(f"  {ecosystem} zip contains {len(names)} entries")
        for name in names:
            if not name.endswith(".json"):
                continue
            try:
                with zf.open(name) as f:
                    rec = json.load(f)
            except (json.JSONDecodeError, zipfile.BadZipFile):
                continue
            modified = _parse_iso(rec.get("modified"))
            if modified and modified >= since:
                yield rec


def scrape() -> None:
    start = time.time()
    records: list[dict] = []
    error_msg: str | None = None
    status = "success"

    since = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)

    try:
        for ecosystem, zip_url in ECOSYSTEMS.items():
            try:
                for rec in _iter_recent_records(ecosystem, zip_url, since):
                    parsed = _parse_record(rec, ecosystem)
                    if parsed:
                        records.append(parsed)
            except Exception as e:
                logger.error(f"OSV {ecosystem} fetch failed: {e}")
                # keep going; other ecosystems may succeed

        logger.info(
            f"Parsed {len(records)} OSV advisories across {len(ECOSYSTEMS)} ecosystems"
        )

        if records:
            cve_ids = [r["identifier"] for r in records if r["identifier_type"] == "cve"]
            if cve_ids:
                epss_map = fetch_epss_scores(cve_ids)
                for r in records:
                    hit = epss_map.get(r["identifier"])
                    if hit:
                        r["epss_score"] = hit[0]
                        r["epss_percentile"] = hit[1]

    except Exception as e:
        error_msg = str(e)
        status = "error"
        logger.error(f"OSV scrape failed: {e}")

    with get_db() as conn:
        upsert_stats = {"new": 0, "updated": 0, "skipped": 0}
        if records:
            try:
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
                logger.error(f"OSV upsert failed: {e}")

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
        f"OSV scrape complete: {upsert_stats['new']} new, "
        f"{upsert_stats['updated']} updated, {upsert_stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
