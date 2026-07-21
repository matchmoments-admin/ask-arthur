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
                item.get("country_code"),
            ))

        if rows:
            try:
                # Single round-trip per batch: send all rows as VALUES list
                results = psycopg2.extras.execute_values(
                    cursor,
                    """
                    SELECT bulk_upsert_feed_url(
                        t.c1, t.c2, t.c3, t.c4, t.c5, t.c6, t.c7, t.c8,
                        t.c9::timestamptz, t.c10, t.c11
                    )
                    FROM (VALUES %s) AS t(c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11)
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
                            "SELECT bulk_upsert_feed_url(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
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
                item.get("country_code"),
            ))

        if rows:
            try:
                results = psycopg2.extras.execute_values(
                    cursor,
                    """
                    SELECT bulk_upsert_feed_crypto_wallet(
                        t.c1, t.c2, t.c3, t.c4, t.c5, t.c6,
                        t.c7::timestamptz, t.c8, t.c9
                    )
                    FROM (VALUES %s) AS t(c1, c2, c3, c4, c5, c6, c7, c8, c9)
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
                            "%s, %s, %s, %s, %s, %s, %s::timestamptz, %s, %s)",
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


def bulk_upsert_entities(
    conn,
    entities: list[dict],
    feed_name: str,
) -> dict:
    """Upsert a batch of entities (phones, emails, etc.) via bulk_upsert_feed_entity() RPC.

    Same 500/batch pattern as bulk_upsert_urls().

    Each item in `entities` should have:
        - entity_type: str (phone, email, domain, etc.)
        - normalized_value: str
    Optional:
        - feed_reference_url: str
        - feed_reported_at: str (ISO 8601)
        - evidence_r2_key: str

    Returns stats: {new: int, updated: int, skipped: int}
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    total = len(entities)
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    cursor = conn.cursor()
    upsert_start = time.time()

    logger.info(
        f"Starting entity upsert: {total} entities in {total_batches} batches of {BATCH_SIZE}",
        extra={"metadata": {"feed": feed_name}},
    )

    for batch_num, i in enumerate(range(0, total, BATCH_SIZE), start=1):
        batch = entities[i : i + BATCH_SIZE]
        batch_start = time.time()

        rows = []
        for item in batch:
            entity_type = item.get("entity_type", "").strip()
            normalized_value = item.get("normalized_value", "").strip()
            if not entity_type or not normalized_value:
                stats["skipped"] += 1
                continue
            rows.append((
                entity_type,
                normalized_value,
                feed_name,
                item.get("feed_reference_url"),
                item.get("feed_reported_at"),
                item.get("evidence_r2_key"),
                item.get("country_code"),
            ))

        if rows:
            try:
                results = psycopg2.extras.execute_values(
                    cursor,
                    """
                    SELECT bulk_upsert_feed_entity(
                        t.c1, t.c2, t.c3, t.c4,
                        t.c5::timestamptz, t.c6, t.c7
                    )
                    FROM (VALUES %s) AS t(c1, c2, c3, c4, c5, c6, c7)
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
                    f"Entity batch {batch_num} failed, falling back to row-by-row: {e}",
                    extra={"metadata": {"feed": feed_name}},
                )
                for row in rows:
                    try:
                        cursor.execute(
                            "SELECT bulk_upsert_feed_entity("
                            "%s, %s, %s, %s, %s::timestamptz, %s, %s)",
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
                            f"Failed to upsert entity: {row[1]}",
                            extra={"metadata": {"error": str(e2)}},
                        )
                        stats["skipped"] += 1
                        conn.rollback()

        conn.commit()
        batch_ms = int((time.time() - batch_start) * 1000)
        processed = stats["new"] + stats["updated"] + stats["skipped"]
        logger.info(
            f"Entity batch {batch_num}/{total_batches} committed: "
            f"{len(batch)} entities in {batch_ms}ms "
            f"(progress: {processed}/{total}, "
            f"new={stats['new']}, updated={stats['updated']}, skipped={stats['skipped']})",
            extra={"metadata": {"feed": feed_name, "batch": batch_num}},
        )

    cursor.close()
    total_ms = int((time.time() - upsert_start) * 1000)
    logger.info(
        f"Entity upsert complete: {total_ms}ms total — "
        f"{stats['new']} new, {stats['updated']} updated, {stats['skipped']} skipped",
        extra={"metadata": {"feed": feed_name, "duration_ms": total_ms}},
    )
    return stats


def bulk_upsert_feed_items(
    conn,
    items: list[dict],
    feed_name: str,
) -> dict:
    """Upsert a batch of feed items via the upsert_feed_item() RPC.

    Same 500/batch pattern as bulk_upsert_urls().

    Each item in `items` should have:
        - source: str (reddit, user_report, verified_scam, scamwatch)
        - external_id: str
        - title: str
    Optional:
        - description: str
        - url: str
        - source_url: str
        - category: str
        - channel: str
        - r2_image_key: str
        - reddit_image_url: str
        - impersonated_brand: str
        - country_code: str
        - upvotes: int
        - verified: bool
        - source_created_at: str (ISO 8601)

    Returns stats: {new: int, updated: int, skipped: int}
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    total = len(items)
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    cursor = conn.cursor()
    upsert_start = time.time()

    logger.info(
        f"Starting feed item upsert: {total} items in {total_batches} batches of {BATCH_SIZE}",
        extra={"metadata": {"feed": feed_name}},
    )

    for batch_num, i in enumerate(range(0, total, BATCH_SIZE), start=1):
        batch = items[i : i + BATCH_SIZE]
        batch_start = time.time()

        rows = []
        for item in batch:
            title = (item.get("title") or "").strip()
            external_id = (item.get("external_id") or "").strip()
            if not title or not external_id:
                stats["skipped"] += 1
                continue
            rows.append((
                item.get("source", "reddit"),
                external_id,
                title,
                item.get("description"),
                item.get("url"),
                item.get("source_url"),
                item.get("category"),
                item.get("channel"),
                item.get("r2_image_key"),
                item.get("reddit_image_url"),
                item.get("impersonated_brand"),
                item.get("country_code"),
                item.get("upvotes", 0),
                item.get("verified", False),
                item.get("source_created_at"),
            ))

        if rows:
            try:
                results = psycopg2.extras.execute_values(
                    cursor,
                    """
                    SELECT upsert_feed_item(
                        t.c1, t.c2, t.c3, t.c4, t.c5, t.c6, t.c7, t.c8,
                        t.c9, t.c10, t.c11, t.c12, t.c13::int, t.c14::boolean,
                        t.c15::timestamptz
                    )
                    FROM (VALUES %s) AS t(c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15)
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
                    f"Feed item batch {batch_num} failed, falling back to row-by-row: {e}",
                    extra={"metadata": {"feed": feed_name}},
                )
                for row in rows:
                    try:
                        cursor.execute(
                            "SELECT upsert_feed_item("
                            "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                            "%s::int, %s::boolean, %s::timestamptz)",
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
                            f"Failed to upsert feed item: {row[1]}",
                            extra={"metadata": {"error": str(e2)}},
                        )
                        stats["skipped"] += 1
                        conn.rollback()

        conn.commit()
        batch_ms = int((time.time() - batch_start) * 1000)
        processed = stats["new"] + stats["updated"] + stats["skipped"]
        logger.info(
            f"Feed item batch {batch_num}/{total_batches} committed: "
            f"{len(batch)} items in {batch_ms}ms "
            f"(progress: {processed}/{total}, "
            f"new={stats['new']}, updated={stats['updated']}, skipped={stats['skipped']})",
            extra={"metadata": {"feed": feed_name, "batch": batch_num}},
        )

    cursor.close()
    total_ms = int((time.time() - upsert_start) * 1000)
    logger.info(
        f"Feed item upsert complete: {total_ms}ms total — "
        f"{stats['new']} new, {stats['updated']} updated, {stats['skipped']} skipped",
        extra={"metadata": {"feed": feed_name, "duration_ms": total_ms}},
    )
    return stats


# ── Reddit deduplication helpers ──


def get_processed_reddit_posts(conn) -> set[str]:
    """Load all processed Reddit post IDs into memory for dedup."""
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT post_id FROM reddit_processed_posts")
        return {row[0] for row in cursor.fetchall()}
    except Exception as e:
        logger.warning(f"Failed to load processed Reddit posts: {e}")
        conn.rollback()
        return set()
    finally:
        cursor.close()


def mark_reddit_posts_processed(
    conn,
    post_ids: list[tuple[str, str]],
) -> None:
    """Batch-insert processed Reddit post IDs.

    Args:
        conn: Database connection
        post_ids: List of (post_id, subreddit) tuples
    """
    if not post_ids:
        return
    cursor = conn.cursor()
    try:
        psycopg2.extras.execute_values(
            cursor,
            """
            INSERT INTO reddit_processed_posts (post_id, subreddit)
            VALUES %s
            ON CONFLICT (post_id) DO NOTHING
            """,
            post_ids,
        )
        conn.commit()
        logger.info(f"Marked {len(post_ids)} Reddit posts as processed")
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to mark Reddit posts as processed: {e}")
    finally:
        cursor.close()


def cleanup_reddit_posts(conn) -> None:
    """Delete processed Reddit posts older than 30 days via RPC."""
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT cleanup_old_reddit_posts(30)")
        result = cursor.fetchone()
        conn.commit()
        deleted = result[0] if result else 0
        if deleted:
            logger.info(f"Cleaned up {deleted} old Reddit processed posts")
    except Exception as e:
        conn.rollback()
        logger.warning(f"Failed to cleanup old Reddit posts: {e}")
    finally:
        cursor.close()


def bulk_upsert_narrative_feed_items(
    conn,
    items: list[dict],
    feed_name: str,
) -> dict:
    """Direct INSERT ... ON CONFLICT for news-style narrative items.

    Distinct from bulk_upsert_feed_items() which calls the upsert_feed_item
    RPC — that RPC doesn't know about body_md/tags/published_at/evidence_r2_key
    (added in v97). Rather than expand the RPC's signature (which would
    require migration coordination with reddit_scams.py), this helper writes
    the new columns directly via SQL.

    Required keys per item:
        source, external_id, title

    Optional keys:
        description, url, source_url, category, country_code,
        impersonated_brand, body_md, tags, published_at, evidence_r2_key,
        provenance_tier, source_created_at

    Returns stats: {new, updated, skipped}.
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    if not items:
        return stats

    cursor = conn.cursor()
    upsert_start = time.time()
    rows: list[tuple] = []

    for item in items:
        source = (item.get("source") or "").strip()
        external_id = (item.get("external_id") or "").strip()
        title = (item.get("title") or "").strip()
        if not source or not external_id or not title:
            stats["skipped"] += 1
            continue
        rows.append((
            source,
            external_id,
            title,
            item.get("description"),
            item.get("url"),
            item.get("source_url"),
            item.get("category"),
            item.get("country_code"),
            item.get("impersonated_brand"),
            item.get("body_md"),
            item.get("tags"),  # list[str] -> Postgres TEXT[]
            item.get("published_at"),
            item.get("evidence_r2_key"),
            # provenance_tier_t enum: tier_1_regulator | tier_2_industry |
            # tier_3_curated | tier_4_osint | tier_5_community. Regulator
            # scrapers (Scamwatch/ACSC/ASIC) all map to tier_1_regulator.
            item.get("provenance_tier", "tier_1_regulator"),
            item.get("source_created_at") or item.get("published_at"),
        ))

    if not rows:
        cursor.close()
        return stats

    # ON CONFLICT key uses the partial unique index on (source, external_id)
    # WHERE external_id IS NOT NULL. xmax = 0 in the RETURNING expression
    # means "this row is freshly inserted" — anything else is an update.
    try:
        results = psycopg2.extras.execute_values(
            cursor,
            """
            INSERT INTO public.feed_items
              (source, external_id, title, description, url, source_url,
               category, country_code, impersonated_brand, body_md, tags,
               published_at, evidence_r2_key, provenance_tier, source_created_at,
               published, created_at)
            VALUES %s
            ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
            DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              url = EXCLUDED.url,
              source_url = EXCLUDED.source_url,
              category = EXCLUDED.category,
              country_code = EXCLUDED.country_code,
              impersonated_brand = EXCLUDED.impersonated_brand,
              body_md = EXCLUDED.body_md,
              tags = EXCLUDED.tags,
              published_at = EXCLUDED.published_at,
              evidence_r2_key = EXCLUDED.evidence_r2_key,
              source_created_at = EXCLUDED.source_created_at
            RETURNING (xmax = 0) AS is_new
            """,
            [(*r, True) for r in rows],
            template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())",
            fetch=True,
        )
        for row in results:
            if row[0]:
                stats["new"] += 1
            else:
                stats["updated"] += 1
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(
            f"bulk_upsert_narrative_feed_items failed: {e}",
            extra={"metadata": {"feed": feed_name, "rows": len(rows)}},
        )
        stats["skipped"] = len(rows)
    finally:
        cursor.close()

    total_ms = int((time.time() - upsert_start) * 1000)
    logger.info(
        f"narrative upsert: {stats['new']} new, {stats['updated']} updated, "
        f"{stats['skipped']} skipped in {total_ms}ms",
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


def bulk_upsert_asic_alerts(
    conn,
    alerts: list[dict],
    feed_name: str,
) -> dict:
    """Upsert ASIC Investor Alert entities via the bulk_upsert_asic_alert() RPC.

    One row per regulator-flagged entity (name + aliases + domains). Batched via
    execute_values (one round-trip per BATCH_SIZE, mirroring bulk_upsert_urls) —
    the earlier per-row SAVEPOINT loop meant ~3 round-trips × 4,200 rows in a
    single ~15-min transaction, long enough to trip the pg-stuck-query-watchdog.
    On a batch failure we fall back to row-by-row so one bad record can't drop
    the whole batch.

    Each item in `alerts` should have:
        - entity_name: str (required; skipped if it normalizes to empty)
        - aliases: list[str]        (optional)
        - domains: list[str]        (optional; registrable domains, normalized)
        - alert_type: str | None    (optional)
        - asic_url: str | None      (optional)
        - snapshot_date: str        ('YYYY-MM-DD')
        - raw: dict | None          (optional; stored as jsonb)

    Returns stats: {new, updated, skipped}.
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    total = len(alerts)
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    cursor = conn.cursor()

    def _tally(result_value) -> None:
        data = result_value if isinstance(result_value, dict) else json.loads(result_value)
        if data.get("skipped"):
            stats["skipped"] += 1
        elif data.get("is_new"):
            stats["new"] += 1
        else:
            stats["updated"] += 1

    for batch_num, i in enumerate(range(0, total, BATCH_SIZE), start=1):
        batch = alerts[i : i + BATCH_SIZE]
        rows = []
        for item in batch:
            entity_name = (item.get("entity_name") or "").strip()
            if not entity_name:
                stats["skipped"] += 1
                continue
            raw = item.get("raw")
            rows.append((
                entity_name,
                item.get("aliases") or None,
                item.get("domains") or None,
                item.get("alert_type"),
                item.get("asic_url"),
                item.get("snapshot_date"),
                json.dumps(raw) if raw is not None else None,
            ))

        if rows:
            try:
                results = psycopg2.extras.execute_values(
                    cursor,
                    """
                    SELECT public.bulk_upsert_asic_alert(
                        t.c1, t.c2::text[], t.c3::text[], t.c4, t.c5,
                        t.c6::date, t.c7::jsonb
                    )
                    FROM (VALUES %s) AS t(c1, c2, c3, c4, c5, c6, c7)
                    """,
                    rows,
                    fetch=True,
                )
                for row in results:
                    _tally(row[0])
            except Exception as e:
                conn.rollback()
                logger.warning(
                    f"ASIC alert batch {batch_num} failed, falling back to row-by-row: {e}",
                    extra={"metadata": {"feed": feed_name}},
                )
                for r in rows:
                    try:
                        cursor.execute(
                            "SELECT public.bulk_upsert_asic_alert(%s, %s, %s, %s, %s, %s::date, %s::jsonb)",
                            r,
                        )
                        res = cursor.fetchone()
                        if res:
                            _tally(res[0])
                    except Exception as e2:
                        stats["skipped"] += 1
                        logger.error(
                            f"Failed to upsert ASIC alert: {r[0]}",
                            extra={"metadata": {"error": str(e2), "feed": feed_name}},
                        )
                        conn.rollback()

        conn.commit()
        logger.info(
            f"ASIC alert batch {batch_num}/{total_batches} committed "
            f"(new={stats['new']} updated={stats['updated']} skipped={stats['skipped']})",
            extra={"metadata": {"feed": feed_name, "batch": batch_num}},
        )

    cursor.close()
    logger.info(
        f"ASIC alerts upsert complete: new={stats['new']} updated={stats['updated']} "
        f"skipped={stats['skipped']}",
        extra={"metadata": {"feed": feed_name}},
    )
    return stats


def deactivate_stale_asic_alerts(conn, snapshot_date: str) -> int:
    """Flag ASIC alert rows not present in the latest snapshot as inactive.

    Delegates to the deactivate_stale_asic_alerts(date) RPC — one small UPDATE
    (the registry is a few hundred to low-thousands of rows, not a hot table).
    Returns the number of rows deactivated.
    """
    cursor = conn.cursor()
    cursor.execute(
        "SELECT public.deactivate_stale_asic_alerts(%s::date)", (snapshot_date,)
    )
    count = cursor.fetchone()[0] or 0
    conn.commit()
    cursor.close()
    logger.info(
        f"ASIC alerts deactivated (stale): {count}",
        extra={"metadata": {"count": count}},
    )
    return count
