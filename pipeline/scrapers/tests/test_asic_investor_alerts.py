"""PR-A1 — ASIC Investor Alert List scraper tests.

Fixtures use the REAL Moneysmart JSON field names (verified against the live
feed 2026-07-21: `nameMandatory`, `investorAlertCategoryMandatory`, `websites`,
`otherInformationAliases`) — an earlier version keyed off guessed names (`name`
/`type`/`aliases`) and silently produced zero entities in prod, which these
fixtures now guard against. The DB wiring (bulk_upsert_asic_alert RPC →
asic_investor_alerts) is exercised in prod smoke; this pins the pure transforms.
"""
from __future__ import annotations

import asic_investor_alerts as asic
from asic_investor_alerts import (
    _alert_type,
    _alias_list,
    _build_alert,
    _flatten_urls,
    _is_shared_or_junk,
    _records_from_payload,
    _should_prune,
)
from common.normalize import normalize_url

# A realistic ASIC record, trimmed to the fields the scraper reads.
ASIC_RECORD = {
    "uniqueIdentifier": 42,
    "nameMandatory": "Tag Markets Pty Ltd",
    "investorAlertCategoryMandatory": "Imposter",
    "websites": ["https://www.tagmarkets.com/join"],
    "otherInformationAliases": ["TagMarkets", "T.M. Financials"],
    "otherInformationSocialAccount": None,
    "dateUpdated": "2026-03-04",
}


def _domains_for(record: dict) -> list[str]:
    """Mirror the scraper's per-record domain derivation (incl. the shared/junk
    filter applied in scrape())."""
    domains: list[str] = []
    for raw_url in _flatten_urls(record):
        norm = normalize_url(raw_url)
        if norm is None or _is_shared_or_junk(norm.domain):
            continue
        if norm.domain not in domains:
            domains.append(norm.domain)
    return domains


# --- payload shape tolerance -------------------------------------------------

def test_records_from_payload_bare_list():
    assert _records_from_payload([{"nameMandatory": "A"}, {"nameMandatory": "B"}]) == [
        {"nameMandatory": "A"},
        {"nameMandatory": "B"},
    ]


def test_records_from_payload_wrapped_keys():
    for key in ("records", "data", "items", "entities"):
        assert _records_from_payload({key: [{"nameMandatory": "X"}]}) == [
            {"nameMandatory": "X"}
        ]


def test_records_from_payload_filters_non_dicts():
    assert _records_from_payload([{"nameMandatory": "A"}, "junk", 5, None]) == [
        {"nameMandatory": "A"}
    ]


def test_records_from_payload_unknown_shape_is_empty():
    assert _records_from_payload({"nope": 1}) == []
    assert _records_from_payload("string") == []


# --- URL / domain extraction -------------------------------------------------

def test_flatten_urls_from_websites_field():
    urls = _flatten_urls({"nameMandatory": "X", "websites": ["https://tagmarkets.com"]})
    assert "https://tagmarkets.com" in urls


def test_flatten_urls_from_bare_domain():
    # ASIC often stores a scheme-less host, e.g. "www.cfdstocks.com/"
    urls = _flatten_urls({"nameMandatory": "X", "websites": ["www.cfdstocks.com/"]})
    assert any("cfdstocks.com" in u for u in urls)


def test_domains_derivation_normalizes_to_registrable():
    assert _domains_for(ASIC_RECORD) == ["tagmarkets.com"]


# --- shared-platform / junk deny-list (register-poisoning guard) -------------

def test_is_shared_or_junk():
    for bad in ["facebook.com", "gmail.com", "t.me", "wa.me", "youtube.com",
                "x.com", "instagram.com", "bit.ly", "linktr.ee", "wixsite.com",
                "https", "www", "", None]:
        assert _is_shared_or_junk(bad) is True, bad
    for good in ["tagmarkets.com", "cfdstocks.com", "fx-gam.com", "10brokers.com"]:
        assert _is_shared_or_junk(good) is False, good


def test_flatten_urls_ignores_social_account_field():
    # Social handles are on shared platforms and must NOT become entity domains.
    record = {
        "nameMandatory": "X",
        "websites": ["https://realscam.com"],
        "otherInformationSocialAccount": ["https://t.me/scamgroup", "https://facebook.com/scam"],
    }
    urls = _flatten_urls(record)
    assert "https://realscam.com" in urls
    assert not any("t.me" in u or "facebook.com" in u for u in urls)


def test_domains_exclude_shared_platforms():
    # A record whose "websites" mixes its real domain with a facebook page:
    record = {
        "nameMandatory": "Scam Co",
        "websites": ["https://realscam.com", "https://facebook.com/scamco"],
    }
    assert _domains_for(record) == ["realscam.com"]


# --- alias / alert_type ------------------------------------------------------

def test_alias_list_from_real_field():
    assert _alias_list(ASIC_RECORD) == ["TagMarkets", "T.M. Financials"]


def test_alias_list_absent():
    assert _alias_list({"nameMandatory": "X"}) == []


def test_alert_type_reads_investor_alert_category():
    assert _alert_type(ASIC_RECORD) == "Imposter"
    assert _alert_type({"investorAlertCategoryMandatory": "Unlicensed (Legacy)"}) == "Unlicensed (Legacy)"
    assert _alert_type({"nameMandatory": "X"}) is None


# --- full record shaping (the bug this class of test now guards) -------------

def test_build_alert_full_real_record():
    alert = _build_alert(ASIC_RECORD, _domains_for(ASIC_RECORD), "2026-07-21")
    assert alert is not None
    assert alert["entity_name"] == "Tag Markets Pty Ltd"
    assert alert["aliases"] == ["TagMarkets", "T.M. Financials"]
    assert alert["domains"] == ["tagmarkets.com"]
    assert alert["alert_type"] == "Imposter"
    assert alert["asic_url"] == asic.SOURCE_PAGE
    assert alert["snapshot_date"] == "2026-07-21"
    assert alert["raw"] == ASIC_RECORD


def test_build_alert_without_name_is_dropped():
    # A record missing nameMandatory has nothing to key on.
    assert _build_alert({"websites": ["https://x.com"]}, ["x.com"], "2026-07-21") is None


def test_build_alert_no_urls_yields_empty_domains():
    alert = _build_alert({"nameMandatory": "No Site Ltd"}, [], "2026-07-21")
    assert alert is not None
    assert alert["domains"] == []
    assert alert["aliases"] == []


# --- prune guard (register-wipe protection) ----------------------------------

def test_should_prune_true_on_real_snapshot():
    assert _should_prune([{"entity_name": "X"}], "success") is True


def test_should_prune_false_on_empty_alerts():
    assert _should_prune([], "success") is False


def test_should_prune_false_on_error_status():
    assert _should_prune([{"entity_name": "X"}], "error") is False
    assert _should_prune([{"entity_name": "X"}], "skipped") is False
