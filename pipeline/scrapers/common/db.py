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

    Each item in `urls` should have at minimum:
        - url: str (raw URL to normalize)
    Optional:
        - scam_type: str
        - brand: str

    Returns stats: {new: int, updated: int, skipped: int}
    """
    stats = {"new": 0, "updated": 0, "skipped": 0}
    cursor = conn.cursor()

    for i in range(0, len(urls), BATCH_SIZE):
        batch = urls[i : i + BATCH_SIZE]

        for item in batch:
            raw_url = item.get("url", "")
            result = normalize_url(raw_url)
            if result is None:
                stats["skipped"] += 1
                continue

            try:
                cursor.execute(
                    "SELECT bulk_upsert_feed_url(%s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        result.normalized,
                        result.domain,
                        result.subdomain,
                        result.tld,
                        result.full_path,
                        feed_name,
                        item.get("scam_type"),
                        item.get("brand"),
                    ),
                )
                row = cursor.fetchone()
                if row:
                    data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
                    if data.get("is_new"):
                        stats["new"] += 1
                    else:
                        stats["updated"] += 1
            except Exception as e:
                logger.error(
                    f"Failed to upsert URL: {raw_url}",
                    extra={"metadata": {"error": str(e)}},
                )
                stats["skipped"] += 1
                conn.rollback()
                continue

        conn.commit()

    cursor.close()
    return stats


def log_ingestion(
    conn,
    feed_name: str,
    status: str,
    urls_fetched: int = 0,
    urls_new: int = 0,
    urls_updated: int = 0,
    urls_skipped: int = 0,
    duration_ms: int = 0,
    error_message: str | None = None,
) -> None:
    """Insert a row into feed_ingestion_log for observability."""
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO feed_ingestion_log
          (feed_name, status, urls_fetched, urls_new, urls_updated, urls_skipped, duration_ms, error_message)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            feed_name,
            status,
            urls_fetched,
            urls_new,
            urls_updated,
            urls_skipped,
            duration_ms,
            error_message,
        ),
    )
    conn.commit()
    cursor.close()
