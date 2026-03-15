"""Tests for Reddit r/Scams scraper — IOC extraction and classification.

Pure unit tests with no database or network calls.
"""

import requests

from reddit_scams import (
    _scrub_usernames,
    _detect_au_relevance,
    _map_flair,
    _extract_iocs,
    _extract_first_image,
    _fetch_subreddit_posts,
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


class TestFetchSubredditPosts:
    """JSON API response parsing for _fetch_subreddit_posts."""

    def _mock_response(self, json_data, status_code=200):
        """Create a mock requests.Response."""
        resp = requests.Response()
        resp.status_code = status_code
        resp._content = __import__("json").dumps(json_data).encode()
        return resp

    def test_parses_valid_response(self, monkeypatch):
        json_data = {
            "data": {
                "children": [
                    {"kind": "t3", "data": {"id": "abc", "title": "Scam post"}},
                    {"kind": "t3", "data": {"id": "def", "title": "Another scam"}},
                ]
            }
        }
        monkeypatch.setattr(
            requests, "get", lambda *a, **kw: self._mock_response(json_data)
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert len(posts) == 2
        assert posts[0]["id"] == "abc"
        assert posts[1]["title"] == "Another scam"

    def test_filters_non_t3_kinds(self, monkeypatch):
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
            requests, "get", lambda *a, **kw: self._mock_response(json_data)
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert len(posts) == 2
        assert all(p["id"].startswith("post") for p in posts)

    def test_handles_empty_response(self, monkeypatch):
        json_data = {"data": {"children": []}}
        monkeypatch.setattr(
            requests, "get", lambda *a, **kw: self._mock_response(json_data)
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert posts == []

    def test_handles_missing_data_key(self, monkeypatch):
        json_data = {}
        monkeypatch.setattr(
            requests, "get", lambda *a, **kw: self._mock_response(json_data)
        )
        posts = _fetch_subreddit_posts("Scams", 100)
        assert posts == []

    def test_raises_on_http_error(self, monkeypatch):
        resp = requests.Response()
        resp.status_code = 429
        resp._content = b"Too Many Requests"
        resp.url = "https://www.reddit.com/r/Scams/new.json"
        monkeypatch.setattr(requests, "get", lambda *a, **kw: resp)
        try:
            _fetch_subreddit_posts("Scams", 100)
            assert False, "Should have raised"
        except requests.HTTPError:
            pass
