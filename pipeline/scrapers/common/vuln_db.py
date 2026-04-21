"""Vulnerability DB helpers — bulk upsert + ingestion logging.

Mirrors the bulk_upsert_urls/ips/wallets/entities pattern in db.py but for the
v63 vulnerability tables. Direct INSERT ... ON CONFLICT (identifier) DO UPDATE
instead of an RPC call — vulns are simpler than the URL/entity model and don't
need server-side normalization or canonical-entity reconciliation.
"""

import json
import time

import psycopg2
import psycopg2.extras

from .logging_config import get_logger

logger = get_logger(__name__)

BATCH_SIZE = 200


def _ensure_jsonb(value) -> str:
    """Serialize a value for a JSONB column. Pass-through if already a string."""
    if value is None:
        return "[]"
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str)


def _ensure_array(value) -> list:
    """Coerce a value to a list for a TEXT[] column."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def bulk_upsert_vulnerabilities(
    conn,
    records: list[dict],
    feed_name: str,
) -> dict:
    """Upsert a batch of vulnerability records.

    Each item in `records` should have at minimum:
        - identifier: str (e.g. "CVE-2025-6514", "GHSA-...", "MCP-2026-STDIO")
        - identifier_type: str ("cve", "ghsa", "msrc", "custom")
        - title: str
        - category: str (one of the CHECK constraint values in v63)

    Optional keys:
        - summary, cvss_score, cvss_vector, severity, published_at, last_modified_at
        - affected_products (list/dict, serialized to JSONB)
        - affected_versions (list/dict, serialized to JSONB)
        - subcategory, tags (list)
        - external_references (list/dict, serialized to JSONB)
        - exploit_available, exploited_in_wild, cisa_kev (bool)
        - cisa_kev_added_at
        - au_context (dict, serialized to JSONB)
        - source_feeds (list)

    Returns stats: {new: int, updated: int, skipped: int}
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    total = len(records)
    if total == 0:
        return stats

    cursor = conn.cursor()
    upsert_start = time.time()

    sql = """
        INSERT INTO vulnerabilities (
            identifier, identifier_type, title, summary,
            cvss_score, cvss_vector, severity,
            published_at, last_modified_at,
            affected_products, affected_versions,
            category, subcategory, tags, external_references,
            exploit_available, exploited_in_wild,
            cisa_kev, cisa_kev_added_at,
            au_context, source_feeds
        )
        VALUES %s
        ON CONFLICT (identifier) DO UPDATE SET
            title              = EXCLUDED.title,
            summary            = EXCLUDED.summary,
            cvss_score         = EXCLUDED.cvss_score,
            cvss_vector        = EXCLUDED.cvss_vector,
            severity           = EXCLUDED.severity,
            last_modified_at   = EXCLUDED.last_modified_at,
            affected_products  = EXCLUDED.affected_products,
            affected_versions  = EXCLUDED.affected_versions,
            category           = EXCLUDED.category,
            subcategory        = EXCLUDED.subcategory,
            tags               = EXCLUDED.tags,
            external_references = EXCLUDED.external_references,
            exploit_available  = EXCLUDED.exploit_available,
            exploited_in_wild  = EXCLUDED.exploited_in_wild,
            cisa_kev           = EXCLUDED.cisa_kev,
            cisa_kev_added_at  = EXCLUDED.cisa_kev_added_at,
            au_context         = EXCLUDED.au_context,
            source_feeds       = (
                SELECT ARRAY(SELECT DISTINCT unnest(vulnerabilities.source_feeds || EXCLUDED.source_feeds))
            )
        RETURNING (xmax = 0) AS is_new
    """

    for i in range(0, total, BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        rows = []
        for r in batch:
            identifier = (r.get("identifier") or "").strip()
            title = (r.get("title") or "").strip()
            category = (r.get("category") or "").strip()
            if not identifier or not title or not category:
                stats["skipped"] += 1
                continue
            rows.append((
                identifier,
                r.get("identifier_type", "cve"),
                title,
                r.get("summary"),
                r.get("cvss_score"),
                r.get("cvss_vector"),
                r.get("severity"),
                r.get("published_at"),
                r.get("last_modified_at"),
                _ensure_jsonb(r.get("affected_products", [])),
                _ensure_jsonb(r.get("affected_versions", [])),
                category,
                r.get("subcategory"),
                _ensure_array(r.get("tags", [])),
                _ensure_jsonb(r.get("external_references", [])),
                bool(r.get("exploit_available", False)),
                bool(r.get("exploited_in_wild", False)),
                bool(r.get("cisa_kev", False)),
                r.get("cisa_kev_added_at"),
                _ensure_jsonb(r.get("au_context", {})),
                _ensure_array(r.get("source_feeds", [feed_name])),
            ))

        if not rows:
            continue

        try:
            results = psycopg2.extras.execute_values(
                cursor, sql, rows, fetch=True
            )
            for row in results:
                if row[0]:
                    stats["new"] += 1
                else:
                    stats["updated"] += 1
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.warning(
                f"Vuln batch failed, falling back to row-by-row: {e}",
                extra={"metadata": {"feed": feed_name}},
            )
            for row in rows:
                try:
                    cursor.execute(
                        sql.replace("VALUES %s", "VALUES (" + ",".join(["%s"] * len(row)) + ")"),
                        row,
                    )
                    r = cursor.fetchone()
                    if r:
                        if r[0]:
                            stats["new"] += 1
                        else:
                            stats["updated"] += 1
                    conn.commit()
                except Exception as e2:
                    conn.rollback()
                    stats["skipped"] += 1
                    logger.error(
                        f"Failed to upsert vuln {row[0]}: {e2}",
                        extra={"metadata": {"feed": feed_name}},
                    )

    cursor.close()
    total_ms = int((time.time() - upsert_start) * 1000)
    logger.info(
        f"Vuln upsert complete: {total_ms}ms — "
        f"{stats['new']} new, {stats['updated']} updated, {stats['skipped']} skipped",
        extra={"metadata": {"feed": feed_name, "duration_ms": total_ms}},
    )
    return stats


def log_vuln_ingestion(
    conn,
    feed_name: str,
    status: str,
    records_fetched: int = 0,
    records_new: int = 0,
    records_updated: int = 0,
    records_skipped: int = 0,
    duration_ms: int = 0,
    error_message: str | None = None,
) -> None:
    """Insert a row into vulnerability_ingestion_log for observability."""
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO vulnerability_ingestion_log
          (feed_name, status, records_fetched, records_new, records_updated,
           records_skipped, duration_ms, error_message)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            feed_name,
            status,
            records_fetched,
            records_new,
            records_updated,
            records_skipped,
            duration_ms,
            error_message,
        ),
    )
    conn.commit()
    cursor.close()
