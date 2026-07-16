"""Regression tests for the domain-whois parser used by the deep-investigation
lane. Kept hermetic: psycopg2 is stubbed so the parser (pure regex) is testable
without the DB driver."""
import sys
import types

# The module imports psycopg2 at top level; stub it so importing the pure
# parser doesn't require the driver.
sys.modules.setdefault("psycopg2", types.ModuleType("psycopg2"))
sys.modules.setdefault("psycopg2.extras", types.ModuleType("psycopg2.extras"))

from investigation.investigate import parse_domain_whois  # noqa: E402


def test_au_registrant_and_abn():
    text = (
        "Domain Name: example.com.au\n"
        "Registrar Name: GoDaddy\n"
        "Registrant: EXAMPLE PTY LTD\n"
        "Registrant ID: ABN 12 345 678 901\n"
        "Name Server: ns1.example.com\n"
        "Name Server: ns2.example.com\n"
    )
    r = parse_domain_whois(text)
    assert r["registrar"] == "GoDaddy"
    assert r["registrant"] == "EXAMPLE PTY LTD"
    assert r["abn"] == "12345678901"  # spaces stripped
    assert r["nameServers"] == ["ns1.example.com", "ns2.example.com"]
    assert r["isPrivate"] is False


def test_gtld_creation_and_privacy():
    text = (
        "Registrar: NameCheap, Inc.\n"
        "Creation Date: 2026-07-01T00:00:00Z\n"
        "Registrant Organization: Redacted for Privacy\n"
    )
    r = parse_domain_whois(text)
    assert r["registrar"].startswith("NameCheap")
    assert r["createdDate"].startswith("2026-07-01")
    assert r["isPrivate"] is True
    assert r["abn"] is None


def test_empty_output_is_all_none():
    r = parse_domain_whois("No match for domain.")
    assert r == {
        "registrar": None,
        "createdDate": None,
        "nameServers": [],
        "registrant": None,
        "abn": None,
        "isPrivate": False,
    }
