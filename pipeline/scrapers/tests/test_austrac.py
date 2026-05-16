"""PR-B3 — AUSTRAC RSS scraper tests.

Unit-level: feed a fixture RSS payload into _parse_rss, assert the parser
produces well-shaped feed_items dicts. The end-to-end scrape() wiring
(conditional_get → DB upsert → log_ingestion) is exercised in prod smoke
after the migration applies; this test pins the parsing contract only.
"""
from __future__ import annotations

import austrac
from austrac import _hash_external_id, _infer_category, _parse_rss


FIXTURE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AUSTRAC media releases</title>
    <link>https://www.austrac.gov.au/news-and-media/media-releases</link>
    <description>Australian Transaction Reports and Analysis Centre — media releases.</description>

    <item>
      <title>AUSTRAC and AFP disrupt money-mule network laundering scam proceeds</title>
      <link>https://www.austrac.gov.au/news-and-media/media-releases/austrac-afp-disrupt-money-mule-network</link>
      <description>AUSTRAC and the Australian Federal Police have disrupted a money-laundering network that processed funds from romance and investment scams targeting Australians. The Fintel Alliance operation identified 200 mule accounts. See https://www.austrac.gov.au/business/how-comply-amlctf-program for AMLCTF guidance.</description>
      <pubDate>Mon, 13 May 2026 04:00:00 GMT</pubDate>
      <category>Money laundering</category>
      <category>Scams</category>
    </item>

    <item>
      <title>Updated AML/CTF reporting obligations from 1 July 2026</title>
      <link>https://www.austrac.gov.au/news-and-media/media-releases/updated-amlctf-reporting-2026</link>
      <description>Reporting entities should prepare for amended threshold transaction reporting from 1 July 2026.</description>
      <pubDate>Wed, 08 May 2026 00:00:00 GMT</pubDate>
      <category>Compliance</category>
    </item>

    <item>
      <title>Pig-butchering crypto scam typology — Q1 2026 trend report</title>
      <link>https://www.austrac.gov.au/news-and-media/media-releases/pig-butchering-q1-2026</link>
      <description>AUSTRAC's Fintel Alliance has identified a 40 percent rise in pig-butchering crypto investment scams in Q1 2026.</description>
      <pubDate>Fri, 02 May 2026 00:00:00 GMT</pubDate>
      <category>Investment scams</category>
    </item>

    <!-- Malformed item — missing link should be skipped -->
    <item>
      <title>Broken release</title>
      <description>No link, should be skipped.</description>
    </item>
  </channel>
</rss>
"""


class TestParseRss:
    def test_extracts_three_well_formed_items(self):
        items = _parse_rss(FIXTURE_RSS)
        assert len(items) == 3, (
            f"expected 3 well-formed items (broken item skipped), got {len(items)}"
        )

    def test_skipped_item_missing_link(self):
        items = _parse_rss(FIXTURE_RSS)
        titles = {it["title"] for it in items}
        assert "Broken release" not in titles

    def test_normalises_source_slug(self):
        items = _parse_rss(FIXTURE_RSS)
        assert all(it["source"] == "austrac" for it in items)

    def test_external_id_is_stable_hash_of_link(self):
        items = _parse_rss(FIXTURE_RSS)
        for it in items:
            assert it["external_id"] == _hash_external_id(it["url"])
            assert len(it["external_id"]) == 32

    def test_country_code_au(self):
        items = _parse_rss(FIXTURE_RSS)
        assert all(it["country_code"] == "AU" for it in items)

    def test_provenance_tier_regulator(self):
        items = _parse_rss(FIXTURE_RSS)
        assert all(it["provenance_tier"] == "tier_1_regulator" for it in items)

    def test_tags_include_media_release_marker(self):
        items = _parse_rss(FIXTURE_RSS)
        for it in items:
            assert "media_release" in it["tags"]

    def test_tags_preserve_source_categories(self):
        items = _parse_rss(FIXTURE_RSS)
        mule = next(it for it in items if "money-mule" in it["title"])
        assert "Money laundering" in mule["tags"]
        assert "Scams" in mule["tags"]

    def test_published_at_passthrough(self):
        items = _parse_rss(FIXTURE_RSS)
        mule = next(it for it in items if "money-mule" in it["title"])
        assert mule["published_at"] == "Mon, 13 May 2026 04:00:00 GMT"

    def test_idempotency_same_fixture_same_external_ids(self):
        first = _parse_rss(FIXTURE_RSS)
        second = _parse_rss(FIXTURE_RSS)
        assert [it["external_id"] for it in first] == [
            it["external_id"] for it in second
        ]


class TestInferCategory:
    def test_pig_butchering_is_investment_fraud(self):
        assert _infer_category(
            "Pig-butchering crypto scam typology — Q1 2026 trend report",
            "40 percent rise in pig-butchering crypto investment scams.",
        ) == "investment_fraud"

    def test_money_mule_is_informational(self):
        # Mule operations are AMLCTF-side, not consumer scams — default informational
        # so downstream clustering does the real labelling via embeddings.
        assert _infer_category(
            "AUSTRAC disrupts money-mule network",
            "Money laundering operation processed funds.",
        ) == "informational"

    def test_amlctf_reporting_is_informational(self):
        assert _infer_category(
            "Updated AML/CTF reporting obligations",
            "Reporting entities should prepare for amended threshold reporting.",
        ) == "informational"

    def test_romance_scam_detected(self):
        assert _infer_category(
            "Romance scam Fintel report",
            "Romance grooming patterns detected.",
        ) == "romance_scam"


class TestMalformedInput:
    def test_invalid_xml_returns_empty(self):
        assert _parse_rss("not xml at all <<<") == []

    def test_empty_string_returns_empty(self):
        assert _parse_rss("") == []

    def test_no_channel_returns_empty(self):
        assert _parse_rss("<?xml version='1.0'?><rss version='2.0'></rss>") == []
