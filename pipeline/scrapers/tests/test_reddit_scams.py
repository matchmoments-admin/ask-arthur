"""Tests for Reddit r/Scams scraper — IOC extraction and classification.

Pure unit tests with no database or network calls.
"""

import json
import pytest
import requests

from reddit_scams import (
    _scrub_usernames,
    _detect_au_relevance,
    _map_flair,
    _extract_iocs,
    _extract_first_image,
    _fetch_json_endpoint,
    _fetch_rss_endpoint,
    _extract_post_id_from_permalink,
    _fetch_subreddit_posts,
    _reset_fetch_state,
    _USER_AGENT,
)


class TestScrubUsernames:
    """PII scrubbing — Reddit usernames must never be stored."""

    def test_scrubs_u_slash(self):
        result = _scrub_usernames("Report from u/victim about scam")
        assert "u/victim" not in result
        assert "[REDACTED]" in result

    def test_scrubs_slash_u_slash(self):
        result = _scrub_usernames("Called out /u/scammer")
        assert "/u/scammer" not in result
        assert "[REDACTED]" in result

    def test_preserves_non_username_text(self):
        result = _scrub_usernames("Got a call from 0412345678")
        assert "0412345678" in result

    def test_multiple_usernames(self):
        result = _scrub_usernames("u/alice told u/bob about this")
        assert result.count("[REDACTED]") == 2

    def test_no_usernames(self):
        text = "This is a regular scam report"
        assert _scrub_usernames(text) == text


class TestAURelevance:
    """Australian geo-tagging from keywords."""

    def test_ato_mention(self):
        assert _detect_au_relevance("Got a fake ATO tax refund email") is True

    def test_centrelink_mention(self):
        assert _detect_au_relevance("Centrelink payment scam SMS") is True

    def test_mygov_mention(self):
        assert _detect_au_relevance("Fake myGov login page") is True

    def test_au_phone_prefix(self):
        assert _detect_au_relevance("Called me from +61412345678") is True

    def test_com_au_domain(self):
        assert _detect_au_relevance("Linked to fake-ato.com.au") is True

    def test_gov_au_domain(self):
        assert _detect_au_relevance("Pretending to be from .gov.au") is True

    def test_au_bank(self):
        assert _detect_au_relevance("Fake CommBank text message") is True

    def test_generic_non_au(self):
        assert _detect_au_relevance("Got a PayPal phishing email from USA") is False

    def test_empty_text(self):
        assert _detect_au_relevance("") is False

    def test_case_insensitive(self):
        assert _detect_au_relevance("CENTRELINK scam") is True


class TestFlairMapping:
    """Reddit flair to scam_type taxonomy mapping."""

    def test_phishing_flair(self):
        assert _map_flair("Phishing") == "phishing"

    def test_smishing_flair(self):
        assert _map_flair("Smishing") == "phishing"

    def test_investment_scam(self):
        assert _map_flair("Investment Scam") == "investment_fraud"

    def test_crypto_scam(self):
        assert _map_flair("Crypto Scam") == "investment_fraud"

    def test_romance_scam(self):
        assert _map_flair("Romance Scam") == "romance_scam"

    def test_pig_butchering(self):
        assert _map_flair("Pig Butchering") == "romance_scam"

    def test_tech_support(self):
        assert _map_flair("Tech Support Scam") == "tech_support"

    def test_sextortion(self):
        assert _map_flair("Sextortion") == "sextortion"

    def test_unknown_flair(self):
        assert _map_flair("Random Flair") is None

    def test_none_flair(self):
        assert _map_flair(None) is None

    def test_case_insensitive(self):
        assert _map_flair("PHISHING") == "phishing"

    def test_whitespace_trimmed(self):
        assert _map_flair("  Phishing  ") == "phishing"


class TestExtractIOCs:
    """IOC extraction from post text."""

    POST_URL = "https://reddit.com/r/Scams/comments/abc123"

    def test_extracts_http_url(self):
        text = "Don't click https://evil-phish.com/login please"
        iocs = _extract_iocs(text, self.POST_URL, "phishing", "reddit_rscams")
        assert len(iocs.urls) == 1
        assert "evil-phish.com" in iocs.urls[0]["url"]

    def test_extracts_multiple_urls(self):
        text = "Found https://bad1.com and https://bad2.com/steal"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.urls) == 2

    def test_skips_reddit_urls(self):
        text = "See https://reddit.com/r/Scams/other_post for details"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.urls) == 0

    def test_skips_imgur_urls(self):
        text = "Screenshot: https://imgur.com/abc123"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.urls) == 0

    def test_skips_redd_it_urls(self):
        text = "See https://i.redd.it/image.jpg"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.urls) == 0

    def test_extracts_eth_address(self):
        text = "They asked to send ETH to 0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.wallets) == 1
        assert iocs.wallets[0]["chain"] == "ETH"

    def test_extracts_btc_address(self):
        text = "Bitcoin address: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.wallets) == 1
        assert iocs.wallets[0]["chain"] == "BTC"

    def test_extracts_au_phone(self):
        text = "Scam call from 0412345678"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.phones) == 1
        assert iocs.phones[0]["normalized_value"] == "+61412345678"

    def test_extracts_au_phone_with_country_code(self):
        text = "Called from +61412345678"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.phones) == 1
        assert iocs.phones[0]["normalized_value"] == "+61412345678"

    def test_extracts_email(self):
        text = "Phishing email from scammer@evil-bank.com"
        iocs = _extract_iocs(text, self.POST_URL, "phishing", "reddit_rscams")
        assert len(iocs.emails) == 1
        assert iocs.emails[0]["normalized_value"] == "scammer@evil-bank.com"

    def test_deduplicates_within_post(self):
        text = "Click https://evil.com and also https://evil.com again"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.urls) == 1

    def test_no_iocs_in_clean_text(self):
        text = "Is this a scam? Someone called me about my car warranty."
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert len(iocs.urls) == 0
        assert len(iocs.wallets) == 0
        assert len(iocs.phones) == 0
        assert len(iocs.emails) == 0

    def test_sets_feed_reference_url(self):
        text = "Bad URL: https://evil.com/steal"
        iocs = _extract_iocs(text, self.POST_URL, "phishing", "reddit_rscams")
        assert iocs.urls[0]["feed_reference_url"] == self.POST_URL

    def test_sets_scam_type(self):
        text = "Fake site: https://phish.example.com"
        iocs = _extract_iocs(text, self.POST_URL, "phishing", "reddit_rscams")
        assert iocs.urls[0]["scam_type"] == "phishing"

    def test_sets_post_time(self):
        text = "Bad URL: https://evil.com"
        iocs = _extract_iocs(
            text, self.POST_URL, None, "reddit_rscams",
            post_time="2025-01-15T10:30:00+00:00",
        )
        assert iocs.urls[0]["feed_reported_at"] == "2025-01-15T10:30:00+00:00"

    def test_entity_type_set_for_phone(self):
        text = "Scam call from 0412345678"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert iocs.phones[0]["entity_type"] == "phone"

    def test_entity_type_set_for_email(self):
        text = "From: scammer@example.com"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert iocs.emails[0]["entity_type"] == "email"

    def test_phone_has_feed_reported_at(self):
        text = "Scam call from 0412345678"
        iocs = _extract_iocs(
            text, self.POST_URL, None, "reddit_rscams",
            post_time="2025-01-15T10:30:00+00:00",
        )
        assert iocs.phones[0]["feed_reported_at"] == "2025-01-15T10:30:00+00:00"

    def test_email_has_feed_reported_at(self):
        text = "From: scammer@example.com"
        iocs = _extract_iocs(
            text, self.POST_URL, None, "reddit_rscams",
            post_time="2025-02-01T08:00:00+00:00",
        )
        assert iocs.emails[0]["feed_reported_at"] == "2025-02-01T08:00:00+00:00"

    def test_phone_feed_reported_at_none_when_no_post_time(self):
        text = "Scam call from 0412345678"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert iocs.phones[0]["feed_reported_at"] is None

    def test_email_feed_reported_at_none_when_no_post_time(self):
        text = "From: scammer@example.com"
        iocs = _extract_iocs(text, self.POST_URL, None, "reddit_rscams")
        assert iocs.emails[0]["feed_reported_at"] is None


class TestExtractFirstImage:
    """Image extraction from Reddit post dicts."""

    def test_direct_i_redd_it(self):
        post = {"url": "https://i.redd.it/abc123.jpg"}
        assert _extract_first_image(post) == "https://i.redd.it/abc123.jpg"

    def test_direct_i_imgur(self):
        post = {"url": "https://i.imgur.com/xyz789.png"}
        assert _extract_first_image(post) == "https://i.imgur.com/xyz789.png"

    def test_direct_preview_redd_it(self):
        post = {"url": "https://preview.redd.it/some-image.jpg?auto=webp"}
        assert _extract_first_image(post) == "https://preview.redd.it/some-image.jpg?auto=webp"

    def test_preview_images(self):
        post = {
            "url": "https://reddit.com/r/Scams/comments/abc",
            "preview": {
                "images": [
                    {
                        "source": {
                            "url": "https://preview.redd.it/big.jpg?width=1024&amp;s=abc",
                            "width": 1024,
                            "height": 768,
                        }
                    }
                ]
            },
        }
        result = _extract_first_image(post)
        assert result == "https://preview.redd.it/big.jpg?width=1024&s=abc"

    def test_gallery_media_metadata(self):
        post = {
            "url": "https://www.reddit.com/gallery/abc123",
            "media_metadata": {
                "item1": {
                    "status": "valid",
                    "e": "Image",
                    "s": {
                        "u": "https://preview.redd.it/gallery1.jpg?width=640&amp;format=pjpg",
                    },
                }
            },
        }
        result = _extract_first_image(post)
        assert result == "https://preview.redd.it/gallery1.jpg?width=640&format=pjpg"

    def test_skips_video(self):
        post = {
            "url": "https://v.redd.it/video123",
            "is_video": True,
        }
        assert _extract_first_image(post) is None

    def test_no_image(self):
        post = {"url": "https://reddit.com/r/Scams/comments/selfpost"}
        assert _extract_first_image(post) is None

    def test_non_image_url(self):
        post = {"url": "https://example.com/scam-page"}
        assert _extract_first_image(post) is None

    def test_empty_preview(self):
        post = {
            "url": "https://reddit.com/r/Scams/comments/abc",
            "preview": {"images": []},
        }
        assert _extract_first_image(post) is None

    def test_invalid_gallery_metadata(self):
        post = {
            "url": "https://www.reddit.com/gallery/abc123",
            "media_metadata": {
                "item1": {
                    "status": "failed",
                    "e": "Image",
                    "s": {"u": "https://preview.redd.it/failed.jpg"},
                }
            },
        }
        assert _extract_first_image(post) is None

    def test_empty_dict(self):
        assert _extract_first_image({}) is None


# ── Helpers for mock responses ──

def _make_json_response(json_data, status_code=200):
    """Create a mock requests.Response with JSON body."""
    resp = requests.Response()
    resp.status_code = status_code
    resp._content = json.dumps(json_data).encode()
    resp.headers["Content-Type"] = "application/json"
    return resp


def _make_response(content, status_code=200, content_type="text/plain"):
    """Create a mock requests.Response with raw content."""
    resp = requests.Response()
    resp.status_code = status_code
    if isinstance(content, str):
        resp._content = content.encode()
    else:
        resp._content = content
    resp.headers["Content-Type"] = content_type
    return resp


# Sample Atom XML for RSS tests
_SAMPLE_ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>newest submissions : Scams</title>
  <entry>
    <title>Got a scam call from 0412345678</title>
    <content type="html">&lt;p&gt;They claimed to be from the ATO. URL was https://evil.example.com&lt;/p&gt;</content>
    <link href="https://www.reddit.com/r/Scams/comments/1abc123/got_a_scam_call/"/>
    <updated>2025-06-15T10:30:00+00:00</updated>
  </entry>
  <entry>
    <title>Is this &amp; legit?</title>
    <content type="html">&lt;b&gt;Bold text&lt;/b&gt; check https://dodgy.site.com</content>
    <link href="https://www.reddit.com/r/Scams/comments/2def456/is_this_legit/"/>
    <updated>2025-06-15T09:00:00+00:00</updated>
  </entry>
</feed>"""

_VALID_JSON_DATA = {
    "data": {
        "children": [
            {"kind": "t3", "data": {"id": "abc", "title": "Scam post"}},
            {"kind": "t3", "data": {"id": "def", "title": "Another scam"}},
        ]
    }
}


class TestExtractPostIdFromPermalink:
    """Post ID extraction from Reddit permalink paths."""

    def test_standard_permalink(self):
        assert _extract_post_id_from_permalink(
            "/r/Scams/comments/1abc123/some_title/"
        ) == "1abc123"

    def test_no_trailing_slash(self):
        assert _extract_post_id_from_permalink(
            "/r/Scams/comments/xyz789/title"
        ) == "xyz789"

    def test_empty_string(self):
        assert _extract_post_id_from_permalink("") == ""

    def test_no_comments_segment(self):
        assert _extract_post_id_from_permalink("/r/Scams/new/") == ""


class TestFetchJsonEndpoint:
    """_fetch_json_endpoint: single-endpoint fetch with retry logic."""

    def setup_method(self):
        _reset_fetch_state()

    def test_200_success(self, monkeypatch):
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_json_response(_VALID_JSON_DATA),
        )
        result = _fetch_json_endpoint(
            "https://old.reddit.com/r/Scams/new.json",
            {"limit": 100, "raw_json": 1},
            {"User-Agent": _USER_AGENT},
        )
        assert result is not None
        assert len(result) == 2
        assert result[0]["id"] == "abc"

    def test_403_returns_none_no_retry(self, monkeypatch):
        call_count = 0

        def mock_get(*a, **kw):
            nonlocal call_count
            call_count += 1
            return _make_json_response({}, 403)

        monkeypatch.setattr(requests, "get", mock_get)
        result = _fetch_json_endpoint(
            "https://www.reddit.com/r/Scams/new.json",
            {"limit": 100}, {"User-Agent": _USER_AGENT},
        )
        assert result is None
        assert call_count == 1  # No retries on 403

    def test_429_retried(self, monkeypatch):
        """429 is retried up to _MAX_RETRIES, then raises."""
        monkeypatch.setattr("reddit_scams._RETRY_BASE_DELAY", 0)
        call_count = 0

        def mock_get(*a, **kw):
            nonlocal call_count
            call_count += 1
            resp = requests.Response()
            resp.status_code = 429
            resp._content = b"Too Many Requests"
            resp.url = "https://old.reddit.com/r/Scams/new.json"
            return resp

        monkeypatch.setattr(requests, "get", mock_get)
        with pytest.raises(requests.HTTPError):
            _fetch_json_endpoint(
                "https://old.reddit.com/r/Scams/new.json",
                {"limit": 100}, {"User-Agent": _USER_AGENT},
            )
        assert call_count == 3  # 1 initial + 2 retries

    def test_503_then_success(self, monkeypatch):
        """503 on first attempt, 200 on second."""
        monkeypatch.setattr("reddit_scams._RETRY_BASE_DELAY", 0)
        call_count = 0

        def mock_get(*a, **kw):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _make_json_response({}, 503)
            return _make_json_response(_VALID_JSON_DATA)

        monkeypatch.setattr(requests, "get", mock_get)
        result = _fetch_json_endpoint(
            "https://old.reddit.com/r/Scams/new.json",
            {"limit": 100}, {"User-Agent": _USER_AGENT},
        )
        assert result is not None
        assert len(result) == 2
        assert call_count == 2

    def test_timeout_retried(self, monkeypatch):
        """Timeout is retried, then raised if exhausted."""
        monkeypatch.setattr("reddit_scams._RETRY_BASE_DELAY", 0)
        call_count = 0

        def mock_get(*a, **kw):
            nonlocal call_count
            call_count += 1
            raise requests.exceptions.Timeout("timed out")

        monkeypatch.setattr(requests, "get", mock_get)
        with pytest.raises(requests.exceptions.Timeout):
            _fetch_json_endpoint(
                "https://old.reddit.com/r/Scams/new.json",
                {"limit": 100}, {"User-Agent": _USER_AGENT},
            )
        assert call_count == 3  # 1 initial + 2 retries

    def test_404_raises_immediately(self, monkeypatch):
        """Non-retryable status (404) raises immediately."""
        call_count = 0

        def mock_get(*a, **kw):
            nonlocal call_count
            call_count += 1
            resp = requests.Response()
            resp.status_code = 404
            resp._content = b"Not Found"
            resp.url = "https://old.reddit.com/r/Scams/new.json"
            return resp

        monkeypatch.setattr(requests, "get", mock_get)
        with pytest.raises(requests.HTTPError):
            _fetch_json_endpoint(
                "https://old.reddit.com/r/Scams/new.json",
                {"limit": 100}, {"User-Agent": _USER_AGENT},
            )
        assert call_count == 1


class TestFetchRssEndpoint:
    """_fetch_rss_endpoint: RSS/Atom feed parsing and normalization."""

    def setup_method(self):
        _reset_fetch_state()

    def test_valid_atom_parsing(self, monkeypatch):
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_response(
                _SAMPLE_ATOM, 200, "application/atom+xml"
            ),
        )
        result = _fetch_rss_endpoint("Scams", 100)
        assert result is not None
        assert len(result) == 2
        assert result[0]["title"] == "Got a scam call from 0412345678"
        assert result[0]["id"] == "1abc123"

    def test_403_returns_none(self, monkeypatch):
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_response("Forbidden", 403),
        )
        result = _fetch_rss_endpoint("Scams", 100)
        assert result is None

    def test_flair_always_none(self, monkeypatch):
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_response(
                _SAMPLE_ATOM, 200, "application/atom+xml"
            ),
        )
        result = _fetch_rss_endpoint("Scams", 100)
        assert result is not None
        for post in result:
            assert post["link_flair_text"] is None

    def test_html_tags_stripped_from_content(self, monkeypatch):
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_response(
                _SAMPLE_ATOM, 200, "application/atom+xml"
            ),
        )
        result = _fetch_rss_endpoint("Scams", 100)
        assert result is not None
        # Second entry has <b>Bold text</b> — tags should be stripped
        selftext = result[1]["selftext"]
        assert "<b>" not in selftext
        assert "Bold text" in selftext

    def test_html_entities_unescaped(self, monkeypatch):
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_response(
                _SAMPLE_ATOM, 200, "application/atom+xml"
            ),
        )
        result = _fetch_rss_endpoint("Scams", 100)
        assert result is not None
        # Second entry title has &amp; in source XML — should be decoded
        assert result[1]["title"] == "Is this & legit?"

    def test_post_id_extraction(self, monkeypatch):
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_response(
                _SAMPLE_ATOM, 200, "application/atom+xml"
            ),
        )
        result = _fetch_rss_endpoint("Scams", 100)
        assert result is not None
        assert result[0]["id"] == "1abc123"
        assert result[1]["id"] == "2def456"

    def test_limit_respected(self, monkeypatch):
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_response(
                _SAMPLE_ATOM, 200, "application/atom+xml"
            ),
        )
        result = _fetch_rss_endpoint("Scams", 1)
        assert result is not None
        assert len(result) == 1

    def test_connection_error_returns_none(self, monkeypatch):
        def mock_get(*a, **kw):
            raise requests.exceptions.ConnectionError("refused")

        monkeypatch.setattr(requests, "get", mock_get)
        result = _fetch_rss_endpoint("Scams", 100)
        assert result is None


class TestFetchSubredditPosts:
    """Cascading endpoint fallback for _fetch_subreddit_posts."""

    def setup_method(self):
        _reset_fetch_state()

    def _mock_get_by_url(self, url_responses):
        """Return a mock that dispatches by URL substring."""
        def mock_get(url, *a, **kw):
            for pattern, response in url_responses.items():
                if pattern in url:
                    if callable(response):
                        return response()
                    return response
            # Default: 403
            return _make_json_response({}, 403)
        return mock_get

    def test_oauth_first_path(self, monkeypatch):
        """When OAuth creds are available and work, use oauth endpoint."""
        monkeypatch.setenv("REDDIT_CLIENT_ID", "test_id")
        monkeypatch.setenv("REDDIT_CLIENT_SECRET", "test_secret")
        # Mock token fetch
        monkeypatch.setattr(
            requests, "post",
            lambda *a, **kw: _make_json_response({"access_token": "tok123"}),
        )
        monkeypatch.setattr(
            requests, "get",
            self._mock_get_by_url({
                "oauth.reddit.com": _make_json_response(_VALID_JSON_DATA),
            }),
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert len(posts) == 2

    def test_fallthrough_oauth_to_old_reddit(self, monkeypatch):
        """When OAuth 403s, fall through to old.reddit.com."""
        monkeypatch.setenv("REDDIT_CLIENT_ID", "test_id")
        monkeypatch.setenv("REDDIT_CLIENT_SECRET", "test_secret")
        monkeypatch.setattr(
            requests, "post",
            lambda *a, **kw: _make_json_response({"access_token": "tok123"}),
        )
        monkeypatch.setattr(
            requests, "get",
            self._mock_get_by_url({
                "oauth.reddit.com": _make_json_response({}, 403),
                "old.reddit.com": _make_json_response(_VALID_JSON_DATA),
            }),
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert len(posts) == 2

    def test_fallthrough_to_www(self, monkeypatch):
        """When OAuth not configured and old.reddit 403s, try www."""
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
        monkeypatch.setattr("reddit_scams._RETRY_BASE_DELAY", 0)
        monkeypatch.setattr(
            requests, "get",
            self._mock_get_by_url({
                "old.reddit.com": _make_json_response({}, 403),
                "www.reddit.com": _make_json_response(_VALID_JSON_DATA),
            }),
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert len(posts) == 2

    def test_fallthrough_to_rss(self, monkeypatch):
        """When all JSON endpoints 403, fall through to RSS."""
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)

        def mock_get(url, *a, **kw):
            if ".rss" in url:
                return _make_response(
                    _SAMPLE_ATOM, 200, "application/atom+xml"
                )
            return _make_json_response({}, 403)

        monkeypatch.setattr(requests, "get", mock_get)
        posts = _fetch_subreddit_posts("Scams", 100)
        assert len(posts) == 2
        # RSS posts have no flair
        assert posts[0]["link_flair_text"] is None

    def test_all_endpoints_fail_raises(self, monkeypatch):
        """When every endpoint fails, raises RequestException."""
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)

        def mock_get(url, *a, **kw):
            if ".rss" in url:
                return _make_response("Forbidden", 403)
            return _make_json_response({}, 403)

        monkeypatch.setattr(requests, "get", mock_get)
        with pytest.raises(requests.RequestException, match="All Reddit endpoints failed"):
            _fetch_subreddit_posts("Scams", 100)

    def test_endpoint_cache_reused(self, monkeypatch):
        """After first subreddit succeeds on old_json, second skips OAuth."""
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
        call_urls = []

        def mock_get(url, *a, **kw):
            call_urls.append(url)
            if "old.reddit.com" in url:
                return _make_json_response(_VALID_JSON_DATA)
            return _make_json_response({}, 403)

        monkeypatch.setattr(requests, "get", mock_get)
        # First call: tries old.reddit (after no OAuth)
        _fetch_subreddit_posts("Scams", 100)
        call_urls.clear()
        # Second call: should go straight to old.reddit (cached)
        _fetch_subreddit_posts("phishing", 100)
        assert len(call_urls) == 1
        assert "old.reddit.com" in call_urls[0]

    def test_endpoint_cache_reset_on_failure(self, monkeypatch):
        """If cached endpoint fails for a later subreddit, reset and try chain."""
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
        first_call = True

        def mock_get(url, *a, **kw):
            nonlocal first_call
            if "old.reddit.com" in url:
                if first_call:
                    return _make_json_response(_VALID_JSON_DATA)
                return _make_json_response({}, 403)
            if "www.reddit.com" in url and ".rss" not in url:
                return _make_json_response(_VALID_JSON_DATA)
            if ".rss" in url:
                return _make_response("Forbidden", 403)
            return _make_json_response({}, 403)

        monkeypatch.setattr(requests, "get", mock_get)
        # First subreddit: old.reddit works, gets cached
        posts1 = _fetch_subreddit_posts("Scams", 100)
        assert len(posts1) == 2
        first_call = False
        # Second subreddit: old.reddit now 403s, should fall through to www
        posts2 = _fetch_subreddit_posts("phishing", 100)
        assert len(posts2) == 2

    def test_parses_valid_response(self, monkeypatch):
        """Backward compat: basic JSON parsing still works."""
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_json_response(_VALID_JSON_DATA),
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert len(posts) == 2
        assert posts[0]["id"] == "abc"
        assert posts[1]["title"] == "Another scam"

    def test_filters_non_t3_kinds(self, monkeypatch):
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
        json_data = {
            "data": {
                "children": [
                    {"kind": "t3", "data": {"id": "post1", "title": "Real post"}},
                    {"kind": "t1", "data": {"id": "comment1", "body": "A comment"}},
                    {"kind": "t3", "data": {"id": "post2", "title": "Another post"}},
                ]
            }
        }
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_json_response(json_data),
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert len(posts) == 2
        assert all(p["id"].startswith("post") for p in posts)

    def test_handles_empty_response(self, monkeypatch):
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
        json_data = {"data": {"children": []}}
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_json_response(json_data),
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert posts == []

    def test_handles_missing_data_key(self, monkeypatch):
        monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("REDDIT_CLIENT_SECRET", raising=False)
        monkeypatch.setattr(
            requests, "get",
            lambda *a, **kw: _make_json_response({}),
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert posts == []
