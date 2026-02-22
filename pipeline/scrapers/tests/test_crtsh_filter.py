"""Test crt.sh legitimate domain filtering."""

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
