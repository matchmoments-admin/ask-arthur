"""Browser-impersonating HTTP helper for Cloudflare-fronted sources.

The default `requests` stack fails JA3/TLS fingerprinting on a handful of
hosts (cyber.gov.au article bodies, auscert.org.au, occasionally
ftc.gov). `curl_cffi` ships with curl-impersonate's TLS handshake quirks
baked in and presents as a real Chrome client.

Use this **only when `common/http_cache.conditional_get` is already
failing** with a 403/503/Cloudflare-challenge. Don't make it the default
HTTP client — the regular `requests` path is faster, covered by ETag
caching, and works for ~99% of feeds.

Example:
    from common.http_impersonate import impersonate_get
    resp = impersonate_get("https://www.cyber.gov.au/alert/xyz")
    if resp.status_code == 200:
        body_html = resp.text

Returns a `curl_cffi.requests.Response` (drop-in compatible with
`requests.Response` for `.status_code`, `.text`, `.content`, `.headers`).
"""
from __future__ import annotations

from typing import Any, Optional

from curl_cffi import requests as cffi_requests

from .logging_config import get_logger

logger = get_logger(__name__)

DEFAULT_IMPERSONATE = "chrome120"
DEFAULT_TIMEOUT_S = 90


def impersonate_get(
    url: str,
    *,
    impersonate: str = DEFAULT_IMPERSONATE,
    timeout: int = DEFAULT_TIMEOUT_S,
    headers: Optional[dict] = None,
    **kwargs: Any,
) -> cffi_requests.Response:
    """GET ``url`` with a Chrome TLS fingerprint.

    The ``impersonate`` argument selects which browser profile curl-impersonate
    emulates. ``chrome120`` is the safe default — newer profiles (chrome131+)
    work but trigger more frequent A/B challenges from some WAFs.

    All extra kwargs flow through to ``curl_cffi.requests.get`` — pass
    ``data``/``json``/``cookies`` exactly as you would with the stdlib
    ``requests`` package.

    Errors propagate (does NOT call ``raise_for_status``). The caller is
    expected to log to ``feed_ingestion_log`` and decide whether the response
    is usable based on status code.
    """
    accept_lang = (headers or {}).get("Accept-Language", "en-AU,en;q=0.9")
    merged_headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": accept_lang,
        **(headers or {}),
    }
    logger.debug(
        "impersonate_get",
        extra={"metadata": {"url": url, "impersonate": impersonate, "timeout": timeout}},
    )
    return cffi_requests.get(
        url,
        impersonate=impersonate,
        timeout=timeout,
        headers=merged_headers,
        **kwargs,
    )
