"""Database helpers — Supavisor connection (port 6543), bulk upsert, ingestion logging."""

import os
import time
import json
from contextlib import contextmanager
from typing import Generator

import psycopg2
import psycopg2.extras

from .logging_config import get_logger
from .normalize import normalize_url, NormalizedURL
from .validate import validate_ip, ip_version

logger = get_logger(__name__)

BATCH_SIZE = 500


def get_connection_string() -> str:
    """Get Supavisor connection string from environment."""
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL environment variable is required")
    return url


@contextmanager
def get_db() -> Generator:
    """Context manager for a database connection."""
    conn = psycopg2.connect(get_connection_string())
    try:
        yield conn
    finally:
        conn.close()


def bulk_upsert_urls(
    conn,
    urls: list[dict],
    feed_name: str,
) -> dict:
    """Upsert a batch of URLs via the bulk_upsert_feed_url() RPC.

    Sends each batch as a single SQL round-trip using execute_values
    instead of one call per URL, cutting network latency ~100x.

    Each item in `urls` should have at minimum:
        - url: str (raw URL to normalize)
    Optional:
        - scam_type: str
        - brand: str
        - feed_reported_at: str (ISO 8601 timestamp from the feed)
        - feed_reference_url: str (source attribution URL, e.g. URLhaus detail page)

    Returns stats: {new: int, updated: int, skipped: int}
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    total = len(urls)
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    cursor = conn.cursor()
    upsert_start = time.time()

    logger.info(
        f"Starting upsert: {total} URLs in {total_batches} batches of {BATCH_SIZE}",
        extra={"metadata": {"feed": feed_name}},
    )

    for batch_num, i in enumerate(range(0, total, BATCH_SIZE), start=1):
        batch = urls[i : i + BATCH_SIZE]
        batch_start = time.time()

        # Normalize all URLs in batch, collect valid rows
        rows = []
        for item in batch:
            raw_url = item.get("url", "")
            result = normalize_url(raw_url)
            if result is None:
                stats["skipped"] += 1
                continue
            rows.append((
                result.normalized,
                result.domain,
                result.subdomain,
                result.tld,
                result.full_path,
                feed_name,
                item.get("scam_type"),
                item.get("brand"),
                item.get("feed_reported_at"),
                item.get("feed_reference_url"),
            ))

        if rows:
            try:
                # Single round-trip per batch: send all rows as VALUES list
                results = psycopg2.extras.execute_values(
                    cursor,
                    """
                    SELECT bulk_upsert_feed_url(
                        t.c1, t.c2, t.c3, t.c4, t.c5, t.c6, t.c7, t.c8,
                        t.c9::timestamptz, t.c10
                    )
                    FROM (VALUES %s) AS t(c1, c2, c3, c4, c5, c6, c7, c8, c9, c10)
                    """,
                    rows,
                    fetch=True,
                )
                for row in results:
                    data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
                    if data.get("is_new"):
                        stats["new"] += 1
                    else:
                        stats["updated"] += 1
            except Exception as e:
                conn.rollback()
                logger.warning(
                    f"Batch {batch_num} failed, falling back to row-by-row: {e}",
                    extra={"metadata": {"feed": feed_name}},
                )
                # Fallback: try each row individually so one bad row doesn't skip the batch
                for row in rows:
                    try:
                        cursor.execute(
                            "SELECT bulk_upsert_feed_url(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                            row,
                        )
                        r = cursor.fetchone()
                        if r:
                            data = r[0] if isinstance(r[0], dict) else json.loads(r[0])
                            if data.get("is_new"):
                                stats["new"] += 1
                            else:
                                stats["updated"] += 1
                    except Exception as e2:
                        logger.error(
                            f"Failed to upsert URL: {row[0]}",
                            extra={"metadata": {"error": str(e2)}},
                        )
                        stats["skipped"] += 1
                        conn.rollback()

        conn.commit()
        batch_ms = int((time.time() - batch_start) * 1000)
        processed = stats["new"] + stats["updated"] + stats["skipped"]
        logger.info(
            f"Batch {batch_num}/{total_batches} committed: "
            f"{len(batch)} URLs in {batch_ms}ms "
            f"(progress: {processed}/{total}, "
            f"new={stats['new']}, updated={stats['updated']}, skipped={stats['skipped']})",
            extra={"metadata": {"feed": feed_name, "batch": batch_num}},
        )

    cursor.close()
    total_ms = int((time.time() - upsert_start) * 1000)
    logger.info(
        f"Upsert complete: {total_ms}ms total — "
        f"{stats['new']} new, {stats['updated']} updated, {stats['skipped']} skipped",
        extra={"metadata": {"feed": feed_name, "duration_ms": total_ms}},
    )
    return stats


def bulk_upsert_ips(
    conn,
    ips: list[dict],
    feed_name: str,
) -> dict:
    """Upsert a batch of IPs via the bulk_upsert_feed_ip() RPC.

    Same 500/batch pattern as bulk_upsert_urls(). Validates IPs with
    the ipaddress module before sending.

    Each item in `ips` should have at minimum:
        - ip_address: str
    Optional:
        - port: int
        - as_number: int
        - as_name: str
        - country: str
        - threat_type: str
        - blocklist_count: int
        - feed_reported_at: str (ISO 8601)
        - feed_reference_url: str
        - first_seen: str (ISO 8601)
        - last_online: str (ISO 8601)

    Returns stats: {new: int, updated: int, skipped: int}
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    total = len(ips)
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    cursor = conn.cursor()
    upsert_start = time.time()

    logger.info(
        f"Starting IP upsert: {total} IPs in {total_batches} batches of {BATCH_SIZE}",
        extra={"metadata": {"feed": feed_name}},
    )

    for batch_num, i in enumerate(range(0, total, BATCH_SIZE), start=1):
        batch = ips[i : i + BATCH_SIZE]
        batch_start = time.time()

        rows = []
        for item in batch:
            raw_ip = item.get("ip_address", "")
            valid_ip = validate_ip(raw_ip)
            if valid_ip is None:
                stats["skipped"] += 1
                continue
            rows.append((
                valid_ip,
                ip_version(raw_ip),
                item.get("port"),
                item.get("as_number"),
                item.get("as_name"),
                item.get("country"),
                item.get("threat_type"),
                item.get("blocklist_count", 1),
                feed_name,
                item.get("feed_reported_at"),
                item.get("feed_reference_url"),
                item.get("first_seen"),
                item.get("last_online"),
            ))

        if rows:
            try:
                results = psycopg2.extras.execute_values(
                    cursor,
                    """
                    SELECT bulk_upsert_feed_ip(
                        t.c1::inet, t.c2::int, t.c3::int, t.c4::int,
                        t.c5, t.c6, t.c7, t.c8::int,
                        t.c9, t.c10::timestamptz, t.c11,
                        t.c12::timestamptz, t.c13::timestamptz
                    )
                    FROM (VALUES %s) AS t(c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13)
                    """,
                    rows,
                    fetch=True,
                )
                for row in results:
                    data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
                    if data.get("is_new"):
                        stats["new"] += 1
                    else:
                        stats["updated"] += 1
            except Exception as e:
                conn.rollback()
                logger.warning(
                    f"IP batch {batch_num} failed, falling back to row-by-row: {e}",
                    extra={"metadata": {"feed": feed_name}},
                )
                for row in rows:
                    try:
                        cursor.execute(
                            "SELECT bulk_upsert_feed_ip(%s::inet, %s::int, %s::int, %s::int, "
                            "%s, %s, %s, %s::int, %s, %s::timestamptz, %s, "
                            "%s::timestamptz, %s::timestamptz)",
                            row,
                        )
                        r = cursor.fetchone()
                        if r:
                            data = r[0] if isinstance(r[0], dict) else json.loads(r[0])
                            if data.get("is_new"):
                                stats["new"] += 1
                            else:
                                stats["updated"] += 1
                    except Exception as e2:
                        logger.error(
                            f"Failed to upsert IP: {row[0]}",
                            extra={"metadata": {"error": str(e2)}},
                        )
                        stats["skipped"] += 1
                        conn.rollback()

        conn.commit()
        batch_ms = int((time.time() - batch_start) * 1000)
        processed = stats["new"] + stats["updated"] + stats["skipped"]
        logger.info(
            f"IP batch {batch_num}/{total_batches} committed: "
            f"{len(batch)} IPs in {batch_ms}ms "
            f"(progress: {processed}/{total}, "
            f"new={stats['new']}, updated={stats['updated']}, skipped={stats['skipped']})",
            extra={"metadata": {"feed": feed_name, "batch": batch_num}},
        )

    cursor.close()
    total_ms = int((time.time() - upsert_start) * 1000)
    logger.info(
        f"IP upsert complete: {total_ms}ms total — "
        f"{stats['new']} new, {stats['updated']} updated, {stats['skipped']} skipped",
        extra={"metadata": {"feed": feed_name, "duration_ms": total_ms}},
    )
    return stats


def bulk_upsert_crypto_wallets(
    conn,
    wallets: list[dict],
    feed_name: str,
) -> dict:
    """Upsert a batch of crypto wallets via the bulk_upsert_feed_crypto_wallet() RPC.

    Same 500/batch pattern as bulk_upsert_urls().

    Each item in `wallets` should have:
        - address: str
        - chain: str (ETH, BTC, SOL, TRON, OTHER)
    Optional:
        - associated_url: str
        - associated_domain: str
        - scam_type: str
        - feed_reported_at: str (ISO 8601)
        - feed_reference_url: str

    Returns stats: {new: int, updated: int, skipped: int}
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    total = len(wallets)
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    cursor = conn.cursor()
    upsert_start = time.time()

    logger.info(
        f"Starting wallet upsert: {total} wallets in {total_batches} batches of {BATCH_SIZE}",
        extra={"metadata": {"feed": feed_name}},
    )

    for batch_num, i in enumerate(range(0, total, BATCH_SIZE), start=1):
        batch = wallets[i : i + BATCH_SIZE]
        batch_start = time.time()

        rows = []
        for item in batch:
            address = item.get("address", "").strip()
            chain = item.get("chain", "OTHER").strip()
            if not address:
                stats["skipped"] += 1
                continue
            rows.append((
                address,
                chain,
                item.get("associated_url"),
                item.get("associated_domain"),
                item.get("scam_type"),
                feed_name,
                item.get("feed_reported_at"),
                item.get("feed_reference_url"),
            ))

        if rows:
            try:
                results = psycopg2.extras.execute_values(
                    cursor,
                    """
                    SELECT bulk_upsert_feed_crypto_wallet(
                        t.c1, t.c2, t.c3, t.c4, t.c5, t.c6,
                        t.c7::timestamptz, t.c8
                    )
                    FROM (VALUES %s) AS t(c1, c2, c3, c4, c5, c6, c7, c8)
                    """,
                    rows,
                    fetch=True,
                )
                for row in results:
                    data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
                    if data.get("is_new"):
                        stats["new"] += 1
                    else:
                        stats["updated"] += 1
            except Exception as e:
                conn.rollback()
                logger.warning(
                    f"Wallet batch {batch_num} failed, falling back to row-by-row: {e}",
                    extra={"metadata": {"feed": feed_name}},
                )
                for row in rows:
                    try:
                        cursor.execute(
                            "SELECT bulk_upsert_feed_crypto_wallet("
                            "%s, %s, %s, %s, %s, %s, %s::timestamptz, %s)",
                            row,
                        )
                        r = cursor.fetchone()
                        if r:
                            data = r[0] if isinstance(r[0], dict) else json.loads(r[0])
                            if data.get("is_new"):
                                stats["new"] += 1
                            else:
                                stats["updated"] += 1
                    except Exception as e2:
                        logger.error(
                            f"Failed to upsert wallet: {row[0]}",
                            extra={"metadata": {"error": str(e2)}},
                        )
                        stats["skipped"] += 1
                        conn.rollback()

        conn.commit()
        batch_ms = int((time.time() - batch_start) * 1000)
        processed = stats["new"] + stats["updated"] + stats["skipped"]
        logger.info(
            f"Wallet batch {batch_num}/{total_batches} committed: "
            f"{len(batch)} wallets in {batch_ms}ms "
            f"(progress: {processed}/{total}, "
            f"new={stats['new']}, updated={stats['updated']}, skipped={stats['skipped']})",
            extra={"metadata": {"feed": feed_name, "batch": batch_num}},
        )

    cursor.close()
    total_ms = int((time.time() - upsert_start) * 1000)
    logger.info(
        f"Wallet upsert complete: {total_ms}ms total — "
        f"{stats['new']} new, {stats['updated']} updated, {stats['skipped']} skipped",
        extra={"metadata": {"feed": feed_name, "duration_ms": total_ms}},
    )
    return stats


def log_ingestion(
    conn,
    feed_name: str,
    status: str,
    records_fetched: int = 0,
    records_new: int = 0,
    records_updated: int = 0,
    records_skipped: int = 0,
    duration_ms: int = 0,
    error_message: str | None = None,
    record_type: str = "url",
) -> None:
    """Insert a row into feed_ingestion_log for observability."""
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO feed_ingestion_log
          (feed_name, status, records_fetched, records_new, records_updated,
           records_skipped, duration_ms, error_message, record_type)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
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
            record_type,
        ),
    )
    conn.commit()
    cursor.close()
