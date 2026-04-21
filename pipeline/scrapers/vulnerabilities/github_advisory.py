"""GitHub Security Advisory (GHSA) scraper.

Source: GitHub GraphQL API — https://api.github.com/graphql
License: CC0 (advisory text is public domain)
Cadence: Weekly (Sunday 04:00 UTC) via .github/workflows/scrape-vulnerabilities.yml

Auth: GHSA_PAT env var must be a fine-grained PAT with the `read:security_events`
scope. No-ops gracefully when unset so the workflow can land before the token is
provisioned (see workflow `if: env.GHSA_PAT != ''` gate).

Ecosystem filter: we only ingest advisories for npm, pypi, maven, and go — the
package managers most relevant to our users. Rubygems/composer/nuget are
deferred to a follow-up if demand appears.
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

FEED_NAME = "github_advisory"
GRAPHQL_URL = "https://api.github.com/graphql"
LOOKBACK_DAYS = 7
ECOSYSTEMS = ["NPM", "PIP", "MAVEN", "GO"]
PAGE_SIZE = 100  # GraphQL max
USER_AGENT = "AskArthur-VulnIntel/1.0 (+https://askarthur.au)"

QUERY = """
query($ecosystem: SecurityAdvisoryEcosystem!, $since: DateTime!, $first: Int!, $after: String) {
  securityAdvisories(
    ecosystem: $ecosystem,
    updatedSince: $since,
    orderBy: { field: UPDATED_AT, direction: DESC },
    first: $first,
    after: $after
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ghsaId
      summary
      description
      severity
      publishedAt
      updatedAt
      withdrawnAt
      references { url }
      identifiers { type value }
      cvss { score vectorString }
      vulnerabilities(first: 20) {
        nodes {
          package { name ecosystem }
          firstPatchedVersion { identifier }
          vulnerableVersionRange
        }
      }
    }
  }
}
"""


def _map_severity(severity: str | None) -> str | None:
    """GHSA severity values are CRITICAL/HIGH/MODERATE/LOW — normalize to v63."""
    if not severity:
        return None
    s = severity.lower()
    if s == "moderate":
        return "medium"
    return s  # critical, high, low


def _ecosystem_category(ecosystem: str) -> str:
    """Rough category mapping from GHSA ecosystem code to v63 category."""
    e = ecosystem.lower()
    if e in ("npm",):
        return "web"  # JS/TS web packages
    if e in ("pip",):
        return "software"
    if e in ("maven", "go"):
        return "software"
    return "software"


def _pick_cve(identifiers: list[dict]) -> str | None:
    """An advisory can carry both a GHSA and a CVE id. We prefer CVE when present
    so that EPSS enrichment works + so cross-feed dedup works with NVD.
    """
    for ident in identifiers or []:
        if ident.get("type") == "CVE":
            value = ident.get("value")
            if value:
                return value
    return None


def _fetch_page(ecosystem: str, since_iso: str, after: str | None, token: str) -> dict:
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
    }
    variables = {
        "ecosystem": ecosystem,
        "since": since_iso,
        "first": PAGE_SIZE,
        "after": after,
    }
    resp = requests.post(
        GRAPHQL_URL,
        json={"query": QUERY, "variables": variables},
        headers=headers,
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("errors"):
        raise RuntimeError(f"GHSA GraphQL errors: {payload['errors']}")
    return payload.get("data", {}).get("securityAdvisories", {})


def _parse_node(node: dict, ecosystem: str) -> dict | None:
    ghsa_id = node.get("ghsaId")
    if not ghsa_id:
        return None

    cve_id = _pick_cve(node.get("identifiers") or [])
    # Prefer CVE identifier for cross-feed dedup; keep GHSA in external_references.
    identifier = cve_id or ghsa_id
    identifier_type = "cve" if cve_id else "ghsa"

    vulns = (node.get("vulnerabilities") or {}).get("nodes") or []
    affected_products = sorted({
        f"{v.get('package', {}).get('ecosystem', '').lower()}:{v.get('package', {}).get('name', '')}"
        for v in vulns
        if v.get("package")
    })
    patched_versions = [
        v.get("firstPatchedVersion", {}).get("identifier")
        for v in vulns
        if v.get("firstPatchedVersion") and v["firstPatchedVersion"].get("identifier")
    ]

    cvss = node.get("cvss") or {}
    cvss_score = cvss.get("score")
    cvss_vector = cvss.get("vectorString") or None
    try:
        cvss_score = float(cvss_score) if cvss_score is not None else None
    except (TypeError, ValueError):
        cvss_score = None

    refs = [{"url": f"https://github.com/advisories/{ghsa_id}", "source": "ghsa"}]
    if cve_id:
        refs.append({"url": f"https://nvd.nist.gov/vuln/detail/{cve_id}", "source": "nvd"})
    for r in node.get("references") or []:
        url = r.get("url")
        if url:
            refs.append({"url": url, "source": "ghsa_ref"})

    withdrawn = node.get("withdrawnAt")
    lifecycle_status = "withdrawn" if withdrawn else "disclosed"

    summary = node.get("summary") or ""
    title = summary[:200] if summary else ghsa_id

    return {
        "identifier": identifier,
        "identifier_type": identifier_type,
        "title": title,
        "summary": node.get("description"),
        "cvss_score": cvss_score,
        "cvss_vector": cvss_vector,
        "severity": _map_severity(node.get("severity")),
        "published_at": node.get("publishedAt"),
        "last_modified_at": node.get("updatedAt"),
        "affected_products": affected_products,
        "category": _ecosystem_category(ecosystem),
        "subcategory": ecosystem.lower(),
        "tags": ["ghsa", ecosystem.lower()],
        "external_references": refs,
        "source_feeds": [FEED_NAME],
        "patched_in_versions": patched_versions,
        "lifecycle_status": lifecycle_status,
    }


def scrape() -> None:
    start = time.time()
    records: list[dict] = []
    error_msg: str | None = None
    status = "success"

    token = os.environ.get("GHSA_PAT")
    if not token:
        logger.warning("GHSA_PAT not set — skipping GHSA scrape (graceful no-op)")
        with get_db() as conn:
            log_vuln_ingestion(
                conn,
                feed_name=FEED_NAME,
                status="skipped",
                duration_ms=int((time.time() - start) * 1000),
                error_message="GHSA_PAT env var not configured",
            )
        return

    since = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    since_iso = since.strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        for ecosystem in ECOSYSTEMS:
            logger.info(f"Fetching GHSA advisories for {ecosystem} since {since_iso}")
            after: str | None = None
            pages = 0
            while True:
                pages += 1
                result = _fetch_page(ecosystem, since_iso, after, token)
                nodes = result.get("nodes") or []
                for node in nodes:
                    parsed = _parse_node(node, ecosystem)
                    if parsed:
                        records.append(parsed)

                page_info = result.get("pageInfo") or {}
                if not page_info.get("hasNextPage") or pages >= 10:
                    break
                after = page_info.get("endCursor")
                time.sleep(0.5)  # be polite to the GraphQL endpoint

            logger.info(f"  {ecosystem}: {pages} page(s) scanned")

        logger.info(f"Parsed {len(records)} GHSA advisories across {len(ECOSYSTEMS)} ecosystems")

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
        logger.error(f"GHSA scrape failed: {e}")

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
                logger.error(f"GHSA upsert failed: {e}")

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
        f"GHSA scrape complete: {upsert_stats['new']} new, "
        f"{upsert_stats['updated']} updated, {upsert_stats['skipped']} skipped in {duration_ms}ms"
    )


if __name__ == "__main__":
    scrape()
