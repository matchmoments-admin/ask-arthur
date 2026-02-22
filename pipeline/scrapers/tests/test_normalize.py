"""CRITICAL: Verify Python/TS normalization parity.

These test cases must produce identical output in both:
  - Python: pipeline/scrapers/common/normalize.py
  - TypeScript: packages/scam-engine/src/url-normalize.ts
"""

from common.normalize import normalize_url


class TestNormalizeURL:
    """Core normalization — must match TypeScript exactly."""

    def test_basic_url(self):
        result = normalize_url("https://example.com/path")
        assert result is not None
        assert result.normalized == "https://example.com/path"
        assert result.domain == "example.com"
        assert result.subdomain is None

    def test_lowercases_hostname(self):
        result = normalize_url("https://EXAMPLE.COM/Path")
        assert result is not None
        assert result.normalized == "https://example.com/Path"

    def test_strips_tracking_params(self):
        result = normalize_url(
            "https://evil.com/login?user=1&utm_source=email&fbclid=abc"
        )
        assert result is not None
        assert "utm_source" not in result.normalized
        assert "fbclid" not in result.normalized
        assert "user=1" in result.normalized

    def test_strips_fragment(self):
        result = normalize_url("https://phish.com/page#section")
        assert result is not None
        assert "#" not in result.normalized
        assert result.normalized == "https://phish.com/page"

    def test_strips_trailing_slash(self):
        result = normalize_url("https://evil.com/path/")
        assert result is not None
        assert result.normalized == "https://evil.com/path"

    def test_preserves_root_slash(self):
        result = normalize_url("https://evil.com/")
        assert result is not None
        assert result.normalized == "https://evil.com/"

    def test_decodes_path(self):
        result = normalize_url("https://evil.com/%70ath")
        assert result is not None
        assert result.normalized == "https://evil.com/path"

    def test_rejects_non_http(self):
        assert normalize_url("ftp://evil.com/file") is None
        assert normalize_url("javascript:alert(1)") is None

    def test_rejects_invalid_url(self):
        assert normalize_url("not a url") is None
        assert normalize_url("") is None

    def test_extracts_subdomain(self):
        result = normalize_url("https://login.fake-telstra.com/auth")
        assert result is not None
        assert result.subdomain == "login"
        assert result.domain == "fake-telstra.com"

    def test_au_tld(self):
        result = normalize_url("https://fake-ato.com.au/refund")
        assert result is not None
        assert result.tld == ".com.au"
        assert result.domain == "fake-ato.com.au"

    def test_preserves_query_params(self):
        result = normalize_url("https://evil.com/page?id=123&action=login")
        assert result is not None
        assert "id=123" in result.normalized
        assert "action=login" in result.normalized

    def test_full_path_includes_query(self):
        result = normalize_url("https://evil.com/page?id=123")
        assert result is not None
        assert result.full_path.startswith("/page")
        assert "id=123" in result.full_path
