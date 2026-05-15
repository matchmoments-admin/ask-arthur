"""Tests for common/http_impersonate.py.

The helper is a thin wrapper around `curl_cffi.requests.get` that pins
sensible defaults. The unit test confirms the wiring (impersonate +
timeout + headers are forwarded as documented). The opt-in live test
hits cyber.gov.au and only runs when ASKARTHUR_HTTP_IMPERSONATE_LIVE=1
— it's there for ad-hoc verification when a WAF behaviour changes and
the impersonate profile needs to be bumped (chrome120 → chrome131
etc.), not as part of the regular CI run.
"""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from common.http_impersonate import DEFAULT_IMPERSONATE, DEFAULT_TIMEOUT_S, impersonate_get


def test_impersonate_get_forwards_default_kwargs():
    """The wrapper must pass impersonate, timeout, and Accept-* headers to
    curl_cffi.requests.get exactly as documented — otherwise downstream
    scrapers can't reason about the network behaviour they'll see."""
    with patch("common.http_impersonate.cffi_requests.get") as mock_get:
        mock_get.return_value.status_code = 200
        impersonate_get("https://example.test/foo")

        mock_get.assert_called_once()
        _, kwargs = mock_get.call_args
        assert kwargs["impersonate"] == DEFAULT_IMPERSONATE
        assert kwargs["timeout"] == DEFAULT_TIMEOUT_S
        assert "Accept" in kwargs["headers"]
        assert kwargs["headers"]["Accept-Language"].startswith("en-AU")


def test_impersonate_get_caller_can_override_headers_and_profile():
    """A caller upgrading to chrome131 for a specific source must be able to
    pass it through without monkey-patching the module."""
    with patch("common.http_impersonate.cffi_requests.get") as mock_get:
        mock_get.return_value.status_code = 200
        impersonate_get(
            "https://example.test/bar",
            impersonate="chrome131",
            headers={"Accept-Language": "en-US,en;q=0.9", "X-Custom": "1"},
        )

        _, kwargs = mock_get.call_args
        assert kwargs["impersonate"] == "chrome131"
        assert kwargs["headers"]["Accept-Language"] == "en-US,en;q=0.9"
        assert kwargs["headers"]["X-Custom"] == "1"
        # Default Accept header should still be present (caller didn't override).
        assert kwargs["headers"]["Accept"].startswith("text/html")


def test_impersonate_get_does_not_raise_on_non_2xx():
    """The helper deliberately doesn't call raise_for_status — callers need
    to inspect the status code (some WAFs return 403 with a usable body
    that still needs logging to feed_ingestion_log)."""
    with patch("common.http_impersonate.cffi_requests.get") as mock_get:
        mock_get.return_value.status_code = 403
        resp = impersonate_get("https://example.test/blocked")
        assert resp.status_code == 403  # didn't raise


@pytest.mark.skipif(
    os.environ.get("ASKARTHUR_HTTP_IMPERSONATE_LIVE") != "1",
    reason="Live network test — set ASKARTHUR_HTTP_IMPERSONATE_LIVE=1 to enable.",
)
def test_impersonate_get_live_cyber_gov_au():
    """Opt-in integration test: confirms the current impersonate profile
    still gets past the Cloudflare front on cyber.gov.au. Run this when
    bumping the default profile or after a reported scraper failure."""
    resp = impersonate_get("https://www.cyber.gov.au/", timeout=30)
    assert resp.status_code == 200, f"Got {resp.status_code} — Cloudflare may have rotated; bump impersonate profile."
    assert "Australian Signals Directorate" in resp.text or "cyber" in resp.text.lower()
