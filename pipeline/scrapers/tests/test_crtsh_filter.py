"""Test crt.sh legitimate domain filtering + null-field regression (#227)."""

from unittest.mock import MagicMock, patch

import crtsh
from crtsh import is_legitimate_domain


class TestLegitDomainFilter:
    """Ensure we don't flag real brand domains as suspicious."""

    def test_exact_legitimate(self):
        assert is_legitimate_domain("commbank.com.au") is True
        assert is_legitimate_domain("ato.gov.au") is True
        assert is_legitimate_domain("my.gov.au") is True
        assert is_legitimate_domain("telstra.com") is True

    def test_subdomain_of_legitimate(self):
        assert is_legitimate_domain("www.commbank.com.au") is True
        assert is_legitimate_domain("online.ato.gov.au") is True
        assert is_legitimate_domain("app.my.gov.au") is True

    def test_cdn_domains(self):
        assert is_legitimate_domain("d123.cloudfront.net") is True
        assert is_legitimate_domain("static.akamaized.net") is True

    def test_suspicious_domains(self):
        assert is_legitimate_domain("commbank-login.com") is False
        assert is_legitimate_domain("ato-refund.xyz") is False
        assert is_legitimate_domain("my-gov-au.net") is False
        assert is_legitimate_domain("telstra-billing.com") is False

    def test_trailing_dot(self):
        assert is_legitimate_domain("commbank.com.au.") is True

    def test_case_insensitive(self):
        assert is_legitimate_domain("COMMBANK.COM.AU") is True
        assert is_legitimate_domain("ATO.GOV.AU") is True


class TestNullFieldRegression:
    """#227 — crt.sh occasionally returns certs with explicit null values
    for common_name and not_before. The previous code used
    `cert.get(k, "").strip()` which only falls back to "" when the key is
    missing, not when the value is None — so None.strip() raised
    AttributeError and tripped the circuit breaker on 2026-05-15.

    These tests pin the contract that the scrape() loop tolerates null
    values gracefully (skips them) instead of crashing the entire run.
    """

    def _fixture_certs_with_nulls(self):
        """Three cert shapes — one valid, two with null fields."""
        return [
            # Normal cert — should be picked up as suspicious.
            {
                "id": 100,
                "common_name": "commbank-login.fake-domain.xyz",
                "not_before": "2026-05-15T10:00:00",
            },
            # Null common_name — must NOT crash. Should be skipped.
            {"id": 101, "common_name": None, "not_before": "2026-05-15T10:00:00"},
            # Null not_before on an otherwise-valid suspicious cert — must
            # NOT crash. Should be picked up with feed_reported_at=None.
            {"id": 102, "common_name": "ato-refund.example.xyz", "not_before": None},
            # Both null — must NOT crash. Should be skipped (no common_name).
            {"id": 103, "common_name": None, "not_before": None},
        ]

    @patch("crtsh.log_ingestion")
    @patch("crtsh.bulk_upsert_urls")
    @patch("crtsh.get_db")
    @patch("crtsh.enforce_backoff_or_skip", return_value=False)
    @patch("crtsh.requests.get")
    def test_scrape_does_not_crash_on_null_cert_fields(
        self, mock_http_get, _mock_backoff, mock_get_db, mock_upsert, _mock_log
    ):
        """Driving scrape() end-to-end with a cert response containing
        nulls must not raise AttributeError. Records the actual URLs
        passed to bulk_upsert_urls so we can confirm the null certs are
        skipped, not embedded with garbage values."""
        # Mock the HTTP layer to always return our null-laden fixture.
        # crt.sh is queried once per AU_BRAND_KEYWORDS keyword.
        fixture_response = MagicMock()
        fixture_response.status_code = 200
        fixture_response.json.return_value = self._fixture_certs_with_nulls()
        mock_http_get.return_value = fixture_response

        # bulk_upsert_urls and get_db are DB-side — return shapes the
        # scraper expects, ignore the contents.
        mock_get_db.return_value.__enter__ = lambda _: MagicMock()
        mock_get_db.return_value.__exit__ = lambda *_: None
        mock_upsert.return_value = {"new": 0, "updated": 0, "skipped": 0}

        # Must not raise. The pre-#227 code would AttributeError here.
        crtsh.scrape()

        # Confirm bulk_upsert_urls was called with the two valid certs,
        # not the nulls. Since the fixture is reused for every keyword
        # (15 keywords), the same two `id` values get deduped via
        # seen_domains and we end up with exactly 2 rows.
        assert mock_upsert.called
        (_, urls_arg, _feed_name), _kwargs = mock_upsert.call_args_list[0][:1][0], {}
        # mock.call_args is positional (conn, urls, feed_name) — pull urls.
        urls_passed = mock_upsert.call_args.args[1]
        seen_hosts = {u["url"] for u in urls_passed}
        assert "https://commbank-login.fake-domain.xyz" in seen_hosts
        assert "https://ato-refund.example.xyz" in seen_hosts
        # Confirm no row was emitted for the null-common_name certs.
        assert len(urls_passed) == 2, (
            f"Expected only the 2 valid certs to be upserted, got {len(urls_passed)}: "
            f"{[u['url'] for u in urls_passed]}"
        )
        # Confirm the null-not_before cert still went through with
        # feed_reported_at=None (not crash, not empty string).
        ato = next(u for u in urls_passed if "ato-refund" in u["url"])
        assert ato["feed_reported_at"] is None
