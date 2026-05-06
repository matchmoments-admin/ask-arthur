"""HTTP conditional-request cache for RSS/HTML scrapers.

Most regulator-narrative feeds (ACSC, FTC, FBI) update a few times per week.
At a 3–6h cron cadence, ≥95% of fetches return identical content. Sending
If-Modified-Since / If-None-Match cuts those fetches to a 304 (zero body)
and lets the scraper short-circuit before parsing.

Backed by public.feed_http_cache (migration v97). Service-role only.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import requests

from .db import get_db
from .logging_config import get_logger

logger = get_logger(__name__)


@dataclass
class ConditionalResponse:
    """Result of a conditional GET. Body is None on 304."""
    status_code: int
    body: Optional[bytes]
    headers: dict
    not_modified: bool

    @property
    def text(self) -> str:
        if self.body is None:
            return ""
        # RSS/HTML — let requests' charset detection handle it via response,
        # but here we operate on bytes. Default to UTF-8 which is correct for
        # all the targets we ship.
        return self.body.decode("utf-8", errors="replace")


def conditional_get(
    source: str,
    url: str,
    *,
    user_agent: str = "AskArthur-ThreatFeed/1.0 (+https://askarthur.au)",
    timeout: int = 90,
    retries: int = 2,
) -> ConditionalResponse:
    """GET ``url`` with cached ETag/Last-Modified headers, persisting the
    new values on a 200.

    On 304: returns body=None and not_modified=True. Caller should treat this
    as "nothing changed since last run" and exit cleanly.

    Errors propagate (raise_for_status). 304 is handled before that, so
    callers don't need a special case for "Not Modified".
    """
    headers = {"User-Agent": user_agent}
    cached_etag: Optional[str] = None
    cached_lm: Optional[str] = None

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT etag, last_modified FROM public.feed_http_cache "
            "WHERE source = %s AND url = %s",
            (source, url),
        )
        row = cur.fetchone()
        if row:
            cached_etag, cached_lm = row[0], row[1]
            if cached_etag:
                headers["If-None-Match"] = cached_etag
            if cached_lm:
                headers["If-Modified-Since"] = cached_lm

    # GitHub Actions runners occasionally see slow / blocked responses from
    # cyber.gov.au (Cloudflare-fronted). Some endpoints appear to filter on
    # User-Agent — the AskArthur UA times out reliably from GH IPs while a
    # generic Mozilla UA succeeds. Strategy:
    #   attempt 0: declared UA at full timeout
    #   attempt 1: Mozilla UA fallback at full timeout (likely unblocks)
    #   attempt 2: Mozilla UA fallback at full timeout (true retry)
    # Errors propagate after the final attempt — caller is expected to log
    # the failure to feed_ingestion_log and exit cleanly.
    MOZILLA_UA = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    )
    last_err: Exception | None = None
    resp = None
    for attempt in range(retries + 1):
        try:
            attempt_headers = dict(headers)
            if attempt > 0:
                attempt_headers["User-Agent"] = MOZILLA_UA
            resp = requests.get(
                url, headers=attempt_headers, timeout=timeout, allow_redirects=True
            )
            break
        except (requests.Timeout, requests.ConnectionError) as err:
            last_err = err
            if attempt >= retries:
                raise
            backoff_s = 2 ** attempt
            logger.warning(
                f"conditional_get retry {attempt + 1}/{retries} after {type(err).__name__}",
                extra={"metadata": {
                    "source": source, "url": url, "backoff_s": backoff_s,
                    "next_ua": "mozilla" if attempt + 1 > 0 else "default",
                }},
            )
            import time as _t
            _t.sleep(backoff_s)
    if resp is None:  # belt-and-suspenders: loop should have raised
        raise last_err or RuntimeError("conditional_get: no response")

    if resp.status_code == 304:
        logger.info("304 Not Modified", extra={"metadata": {"source": source, "url": url}})
        return ConditionalResponse(
            status_code=304, body=None, headers=dict(resp.headers), not_modified=True
        )

    resp.raise_for_status()

    new_etag = resp.headers.get("ETag")
    new_lm = resp.headers.get("Last-Modified")

    # Persist the new validators only if at least one is present. Some feeds
    # send neither — in that case we still want a row so future hits know we
    # tried, but we'll always re-download.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO public.feed_http_cache (source, url, etag, last_modified, status_code, fetched_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (source, url) DO UPDATE
            SET etag = EXCLUDED.etag,
                last_modified = EXCLUDED.last_modified,
                status_code = EXCLUDED.status_code,
                fetched_at = now()
            """,
            (source, url, new_etag, new_lm, resp.status_code),
        )
        conn.commit()

    return ConditionalResponse(
        status_code=resp.status_code,
        body=resp.content,
        headers=dict(resp.headers),
        not_modified=False,
    )
