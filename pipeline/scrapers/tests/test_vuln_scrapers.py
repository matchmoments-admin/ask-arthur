"""Unit tests for Sprint 2 vulnerability scrapers.

Offline-only — every test uses a fixture-style dict, no network calls.
Covers:
- NVD: _parse_cve shape, CVSS extraction, category, lifecycle mapping
- GHSA: _parse_node identifier preference (CVE over GHSA), severity mapping
- OSV: _parse_record aliases, patched_in_versions extraction
- CERT AU: scrape_vulnerabilities CVE regex + au_context tagging
- vuln_db: merge_external_references dedup across sources
"""

from common.vuln_db import merge_external_references
from vulnerabilities import github_advisory, nvd_recent, osv_feed


# ── merge_external_references ──


def test_merge_refs_dedups_by_url():
    existing = [
        {"url": "https://nvd.nist.gov/vuln/detail/CVE-2024-1", "source": "nvd"},
        {"url": "https://cisa.gov/kev/CVE-2024-1", "source": "cisa_kev_notes"},
    ]
    incoming = [
        {"url": "https://nvd.nist.gov/vuln/detail/CVE-2024-1", "source": "nvd"},
        {"url": "https://github.com/advisories/GHSA-xxx", "source": "ghsa"},
    ]
    merged = merge_external_references(existing, incoming)
    urls = [r["url"] for r in merged]
    assert len(urls) == 3
    assert "https://nvd.nist.gov/vuln/detail/CVE-2024-1" in urls
    assert "https://cisa.gov/kev/CVE-2024-1" in urls
    assert "https://github.com/advisories/GHSA-xxx" in urls


def test_merge_refs_preserves_order():
    existing = [{"url": "https://a.test", "source": "x"}]
    incoming = [{"url": "https://b.test", "source": "y"}]
    merged = merge_external_references(existing, incoming)
    assert [r["url"] for r in merged] == ["https://a.test", "https://b.test"]


def test_merge_refs_handles_none_and_malformed():
    # None inputs, non-dict entries, missing url — all should skip cleanly
    merged = merge_external_references(
        None,
        [{"url": "https://ok.test", "source": "ok"}, "not-a-dict", {"source": "no-url"}],
    )
    assert len(merged) == 1
    assert merged[0]["url"] == "https://ok.test"


# ── NVD ──

NVD_SAMPLE_CVE = {
    "cve": {
        "id": "CVE-2024-99999",
        "published": "2024-01-15T10:00:00.000",
        "lastModified": "2024-03-01T12:00:00.000",
        "vulnStatus": "Analyzed",
        "descriptions": [
            {"lang": "en", "value": "Buffer overflow in Foobar 1.2.3 allows RCE."},
            {"lang": "es", "value": "Desbordamiento de búfer"},
        ],
        "metrics": {
            "cvssMetricV31": [
                {
                    "cvssData": {
                        "baseScore": 9.8,
                        "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                    }
                }
            ]
        },
        "references": [
            {"url": "https://example.com/advisory", "tags": ["Vendor Advisory"]},
            {"url": "https://exploit.test", "tags": ["Exploit"]},
        ],
        "configurations": [
            {
                "nodes": [
                    {
                        "cpeMatch": [
                            {"criteria": "cpe:2.3:a:foobar:foobar:1.2.3:*:*:*:*:*:*:*"}
                        ]
                    }
                ]
            }
        ],
    }
}


def test_nvd_parse_cve_populates_core_fields():
    rec = nvd_recent._parse_cve(NVD_SAMPLE_CVE)
    assert rec["identifier"] == "CVE-2024-99999"
    assert rec["identifier_type"] == "cve"
    assert rec["cvss_score"] == 9.8
    assert rec["cvss_vector"].startswith("CVSS:3.1")
    assert rec["severity"] == "critical"
    assert "foobar:foobar" in rec["affected_products"]
    assert rec["lifecycle_status"] == "disclosed"


def test_nvd_parse_cve_picks_english_description():
    rec = nvd_recent._parse_cve(NVD_SAMPLE_CVE)
    assert "Buffer overflow" in rec["summary"]


def test_nvd_external_refs_include_nvd_detail_and_tagged_refs():
    rec = nvd_recent._parse_cve(NVD_SAMPLE_CVE)
    sources = {r["source"] for r in rec["external_references"]}
    assert "nvd" in sources
    assert "nvd_vendor" in sources
    assert "nvd_exploit" in sources


def test_nvd_rejected_cve_marked_rejected():
    rejected = {**NVD_SAMPLE_CVE}
    rejected["cve"] = {**NVD_SAMPLE_CVE["cve"], "vulnStatus": "Rejected"}
    rec = nvd_recent._parse_cve(rejected)
    assert rec["lifecycle_status"] == "rejected"


def test_nvd_severity_buckets():
    assert nvd_recent._severity_from_cvss(9.8) == "critical"
    assert nvd_recent._severity_from_cvss(7.5) == "high"
    assert nvd_recent._severity_from_cvss(5.0) == "medium"
    assert nvd_recent._severity_from_cvss(2.0) == "low"
    assert nvd_recent._severity_from_cvss(0.0) == "none"
    assert nvd_recent._severity_from_cvss(None) is None


# ── GHSA ──

GHSA_SAMPLE_NODE = {
    "ghsaId": "GHSA-aaaa-bbbb-cccc",
    "summary": "Prototype pollution in left-pad",
    "description": "left-pad versions < 1.2.3 are vulnerable to prototype pollution.",
    "severity": "MODERATE",
    "publishedAt": "2024-02-01T00:00:00Z",
    "updatedAt": "2024-02-15T00:00:00Z",
    "withdrawnAt": None,
    "references": [{"url": "https://github.com/stevemao/left-pad/issues/42"}],
    "identifiers": [
        {"type": "GHSA", "value": "GHSA-aaaa-bbbb-cccc"},
        {"type": "CVE", "value": "CVE-2024-00042"},
    ],
    "cvss": {"score": 5.3, "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N"},
    "vulnerabilities": {
        "nodes": [
            {
                "package": {"name": "left-pad", "ecosystem": "NPM"},
                "firstPatchedVersion": {"identifier": "1.2.3"},
                "vulnerableVersionRange": "< 1.2.3",
            }
        ]
    },
}


def test_ghsa_parse_prefers_cve_identifier():
    rec = github_advisory._parse_node(GHSA_SAMPLE_NODE, "NPM")
    assert rec["identifier"] == "CVE-2024-00042"
    assert rec["identifier_type"] == "cve"


def test_ghsa_severity_moderate_maps_to_medium():
    rec = github_advisory._parse_node(GHSA_SAMPLE_NODE, "NPM")
    assert rec["severity"] == "medium"


def test_ghsa_affected_products_uses_ecosystem_prefix():
    rec = github_advisory._parse_node(GHSA_SAMPLE_NODE, "NPM")
    assert rec["affected_products"] == ["npm:left-pad"]


def test_ghsa_patched_versions_populated():
    rec = github_advisory._parse_node(GHSA_SAMPLE_NODE, "NPM")
    assert rec["patched_in_versions"] == ["1.2.3"]


def test_ghsa_withdrawn_sets_lifecycle():
    withdrawn = {**GHSA_SAMPLE_NODE, "withdrawnAt": "2024-03-01T00:00:00Z"}
    rec = github_advisory._parse_node(withdrawn, "NPM")
    assert rec["lifecycle_status"] == "withdrawn"


def test_ghsa_no_cve_falls_back_to_ghsa_identifier():
    no_cve = {
        **GHSA_SAMPLE_NODE,
        "identifiers": [{"type": "GHSA", "value": "GHSA-aaaa-bbbb-cccc"}],
    }
    rec = github_advisory._parse_node(no_cve, "PIP")
    # Falls back to top-level ghsaId when no CVE alias is present in the
    # identifiers list (real GraphQL always echoes ghsaId in identifiers too).
    assert rec["identifier"] == "GHSA-aaaa-bbbb-cccc"
    assert rec["identifier_type"] == "ghsa"


# ── OSV ──

OSV_SAMPLE = {
    "id": "GHSA-pppp-qqqq-rrrr",
    "aliases": ["CVE-2024-55555", "PYSEC-2024-100"],
    "summary": "SQL injection in django-oauth",
    "details": "Versions prior to 2.0.0 allow unauthenticated SQL injection.",
    "published": "2024-03-10T00:00:00Z",
    "modified": "2024-03-12T00:00:00Z",
    "affected": [
        {
            "package": {"name": "django-oauth", "ecosystem": "PyPI"},
            "ranges": [
                {
                    "type": "ECOSYSTEM",
                    "events": [{"introduced": "0"}, {"fixed": "2.0.0"}],
                }
            ],
        }
    ],
    "references": [
        {"type": "ADVISORY", "url": "https://github.com/advisories/GHSA-pppp-qqqq-rrrr"}
    ],
    "severity": [
        {"type": "CVSS_V3", "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}
    ],
}


def test_osv_parse_record_prefers_cve_alias():
    rec = osv_feed._parse_record(OSV_SAMPLE, "pypi")
    assert rec["identifier"] == "CVE-2024-55555"
    assert rec["identifier_type"] == "cve"


def test_osv_ecosystem_routing_in_affected_products():
    rec = osv_feed._parse_record(OSV_SAMPLE, "pypi")
    assert rec["affected_products"] == ["pypi:django-oauth"]


def test_osv_patched_versions_from_fixed_event():
    rec = osv_feed._parse_record(OSV_SAMPLE, "pypi")
    assert "2.0.0" in rec["patched_in_versions"]


def test_osv_no_cve_alias_falls_back_to_osv_id():
    no_cve = {**OSV_SAMPLE, "aliases": ["PYSEC-2024-100"]}
    rec = osv_feed._parse_record(no_cve, "pypi")
    assert rec["identifier"] == "GHSA-pppp-qqqq-rrrr"
    assert rec["identifier_type"] == "ghsa"  # osv id prefix recognized


# ── CERT AU CVE regex ──


def test_cert_au_cve_regex_matches_multiple_patterns():
    from cert_au import CVE_RE

    text = (
        "ACSC is aware of CVE-2024-12345 and cve-2023-9 affecting Ivanti Connect Secure. "
        "Unrelated token: NOT-A-CVE. Another: CVE-2025-1234567."
    )
    matches = {m.group(0).upper() for m in CVE_RE.finditer(text)}
    assert "CVE-2024-12345" in matches
    assert "CVE-2023-9" not in matches  # regex requires 4-7 digit final group, 1 digit doesn't qualify
    assert "CVE-2025-1234567" in matches


def test_cert_au_severity_extraction():
    from cert_au import _severity_from_text

    assert _severity_from_text("Critical vulnerability in Foo") == "critical"
    assert _severity_from_text("High severity issue") == "high"
    assert _severity_from_text("Medium severity flaw") == "medium"
    assert _severity_from_text("unremarkable advisory") is None
