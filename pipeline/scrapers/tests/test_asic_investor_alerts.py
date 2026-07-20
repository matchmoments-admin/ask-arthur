"""PR-A1 — ASIC Investor Alert List scraper tests.

Unit-level: the ASIC JSON shape is undocumented, so pin the parsing +
entity-shaping contract against fixtures of every payload shape we tolerate.
The DB wiring (bulk_upsert_asic_alert RPC → asic_investor_alerts) is exercised
in prod smoke after the migration applies; this test pins the pure transforms.
"""
from __future__ import annotations

import asic_investor_alerts as asic
from asic_investor_alerts import (
    _alert_type,
    _alias_list,
    _build_alert,
    _flatten_urls,
    _records_from_payload,
    _should_prune,
)
from common.normalize import normalize_url


def _domains_for(record: dict) -> list[str]:
    """Mirror the scraper's per-record domain derivation."""
    domains: list[str] = []
    for raw_url in _flatten_urls(record):
        norm = normalize_url(raw_url)
        if norm is None or not norm.domain:
            continue
        if norm.domain not in domains:
            domains.append(norm.domain)
    return domains


# --- payload shape tolerance -------------------------------------------------

def test_records_from_payload_bare_list():
    assert _records_from_payload([{"name": "A"}, {"name": "B"}]) == [
        {"name": "A"},
        {"name": "B"},
    ]


def test_records_from_payload_wrapped_keys():
    for key in ("records", "data", "items", "entities"):
        assert _records_from_payload({key: [{"name": "X"}]}) == [{"name": "X"}]


def test_records_from_payload_filters_non_dicts():
    assert _records_from_payload([{"name": "A"}, "junk", 5, None]) == [{"name": "A"}]


def test_records_from_payload_unknown_shape_is_empty():
    assert _records_from_payload({"nope": 1}) == []
    assert _records_from_payload("string") == []


# --- URL / domain extraction -------------------------------------------------

def test_flatten_urls_from_website_field():
    urls = _flatten_urls({"name": "Tag Markets", "website": "https://tagmarkets.com"})
    assert "https://tagmarkets.com" in urls


def test_flatten_urls_from_bare_domain():
    urls = _flatten_urls({"name": "Sonic AI", "websites": ["sonic-ai.top"]})
    assert any("sonic-ai.top" in u for u in urls)


def test_domains_derivation_normalizes_to_registrable():
    record = {"name": "Tag Markets", "website": "https://www.tagmarkets.com/join"}
    assert _domains_for(record) == ["tagmarkets.com"]


# --- alias / alert_type ------------------------------------------------------

def test_alias_list_from_list():
    assert _alias_list({"aliases": ["TagMarkets", " Tag Markets ", ""]}) == [
        "TagMarkets",
        "Tag Markets",
    ]


def test_alias_list_from_delimited_string():
    assert _alias_list({"aliases": "TagMarkets, Tag Markets\nT.M. Financials"}) == [
        "TagMarkets",
        "Tag Markets",
        "T.M. Financials",
    ]


def test_alias_list_absent():
    assert _alias_list({"name": "X"}) == []


def test_alert_type_prefers_first_present_key():
    assert _alert_type({"category": "imposter"}) == "imposter"
    assert _alert_type({"type": "unlicensed", "category": "x"}) == "unlicensed"
    assert _alert_type({"name": "X"}) is None


# --- full record shaping -----------------------------------------------------

def test_build_alert_full_record():
    record = {
        "name": "Tag Markets Pty Ltd",
        "aliases": ["TagMarkets"],
        "website": "https://tagmarkets.com",
        "type": "imposter",
    }
    alert = _build_alert(record, _domains_for(record), "2026-07-21")
    assert alert is not None
    assert alert["entity_name"] == "Tag Markets Pty Ltd"
    assert alert["aliases"] == ["TagMarkets"]
    assert alert["domains"] == ["tagmarkets.com"]
    assert alert["alert_type"] == "imposter"
    assert alert["asic_url"] == asic.SOURCE_PAGE
    assert alert["snapshot_date"] == "2026-07-21"
    assert alert["raw"] == record


def test_build_alert_without_name_is_dropped():
    assert _build_alert({"website": "https://x.com"}, ["x.com"], "2026-07-21") is None


def test_build_alert_no_urls_yields_empty_domains():
    alert = _build_alert({"name": "No Site Ltd"}, [], "2026-07-21")
    assert alert is not None
    assert alert["domains"] == []
    assert alert["aliases"] == []


# --- prune guard (register-wipe protection) ----------------------------------

def test_should_prune_true_on_real_snapshot():
    assert _should_prune([{"entity_name": "X"}], "success") is True


def test_should_prune_false_on_empty_alerts():
    # 304 Not Modified or a valid-but-empty [] payload → never wipe the register.
    assert _should_prune([], "success") is False


def test_should_prune_false_on_error_status():
    assert _should_prune([{"entity_name": "X"}], "error") is False
    assert _should_prune([{"entity_name": "X"}], "skipped") is False
