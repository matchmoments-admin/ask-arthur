import { describe, expect, it } from "vitest";

import {
  buildMatchesPayload,
  filterMatches,
  meetsMinSeverity,
  versionMatches,
  type VulnerabilityRow,
} from "../match-b2b-exposure";

// Minimum-fields helper to keep test data terse.
function vuln(overrides: Partial<VulnerabilityRow>): VulnerabilityRow {
  return {
    id: 1,
    identifier: "CVE-2025-0000",
    affected_products: ["mcp-remote"],
    affected_versions: [{ range: "<1.0.0" }],
    severity: "critical",
    cvss_score: 9.6,
    cisa_kev: false,
    ...overrides,
  };
}

describe("versionMatches", () => {
  it("returns true when version satisfies one of the ranges", () => {
    expect(
      versionMatches({ name: "p", version: "0.5.0" }, [{ range: "<1.0.0" }]),
    ).toBe(true);
  });

  it("returns false when version is outside every range", () => {
    expect(
      versionMatches({ name: "p", version: "2.0.0" }, [{ range: "<1.0.0" }]),
    ).toBe(false);
  });

  it("supports compound ranges with multiple entries (any-of)", () => {
    const ranges = [{ range: "<1.0.0" }, { range: ">=2.0.0 <3.0.0" }];
    expect(versionMatches({ name: "p", version: "2.5.0" }, ranges)).toBe(true);
    expect(versionMatches({ name: "p", version: "1.5.0" }, ranges)).toBe(false);
  });

  it("coerces non-strict semver inputs (e.g. 'v1.2', '1')", () => {
    expect(
      versionMatches({ name: "p", version: "v1.2" }, [{ range: ">=1.0.0" }]),
    ).toBe(true);
  });

  it("returns false on malformed entries (not an array, missing range, junk shape)", () => {
    expect(versionMatches({ name: "p", version: "1.0.0" }, null)).toBe(false);
    expect(versionMatches({ name: "p", version: "1.0.0" }, "garbage")).toBe(
      false,
    );
    expect(versionMatches({ name: "p", version: "1.0.0" }, [{}])).toBe(false);
    expect(
      versionMatches({ name: "p", version: "1.0.0" }, [{ range: "" }]),
    ).toBe(false);
  });

  it("returns false when the supplied version itself is unparseable", () => {
    expect(
      versionMatches({ name: "p", version: "not-a-version" }, [
        { range: "<99.0.0" },
      ]),
    ).toBe(false);
  });

  it("safely skips invalid range strings", () => {
    expect(
      versionMatches({ name: "p", version: "1.0.0" }, [
        { range: "@@invalid@@" },
        { range: ">=1.0.0" },
      ]),
    ).toBe(true);
  });
});

describe("meetsMinSeverity", () => {
  it("matches when row severity >= min", () => {
    expect(meetsMinSeverity("critical", "high")).toBe(true);
    expect(meetsMinSeverity("high", "high")).toBe(true);
    expect(meetsMinSeverity("medium", "high")).toBe(false);
  });

  it("treats null row severity as info (lowest)", () => {
    expect(meetsMinSeverity(null, "low")).toBe(false);
    expect(meetsMinSeverity(null, "info")).toBe(true);
  });
});

describe("filterMatches", () => {
  it("returns an empty list when no candidates match the products", () => {
    const triples = filterMatches(
      [vuln({ affected_products: ["other-pkg"] })],
      [{ name: "mcp-remote", version: "0.5.0" }],
      "high",
    );
    expect(triples).toHaveLength(0);
  });

  it("returns the cross-product when one product matches two CVEs", () => {
    const cveA = vuln({ id: 1, identifier: "CVE-A" });
    const cveB = vuln({ id: 2, identifier: "CVE-B" });
    const triples = filterMatches(
      [cveA, cveB],
      [{ name: "mcp-remote", version: "0.5.0" }],
      "high",
    );
    expect(triples.map((t) => t.vuln.identifier)).toEqual(["CVE-A", "CVE-B"]);
  });

  it("filters by minSeverity (medium not surfaced when min=high)", () => {
    const triples = filterMatches(
      [
        vuln({
          id: 1,
          identifier: "CVE-MED",
          severity: "medium",
          cvss_score: 5.3,
        }),
      ],
      [{ name: "mcp-remote", version: "0.5.0" }],
      "high",
    );
    expect(triples).toHaveLength(0);
  });

  it("filters by version (out-of-range version is dropped)", () => {
    const triples = filterMatches(
      [vuln({ affected_versions: [{ range: "<1.0.0" }] })],
      [{ name: "mcp-remote", version: "1.5.0" }],
      "high",
    );
    expect(triples).toHaveLength(0);
  });

  it("emits one triple per (product, vuln) match — not deduped on vuln id", () => {
    const sharedVuln = vuln({
      id: 1,
      identifier: "CVE-MULTI",
      affected_products: ["pkg-a", "pkg-b"],
    });
    const triples = filterMatches(
      [sharedVuln],
      [
        { name: "pkg-a", version: "0.1.0" },
        { name: "pkg-b", version: "0.2.0" },
      ],
      "high",
    );
    expect(triples).toHaveLength(2);
    expect(triples.map((t) => t.product.name).sort()).toEqual([
      "pkg-a",
      "pkg-b",
    ]);
  });
});

describe("buildMatchesPayload", () => {
  it("sorts CISA KEV first, then CVSS score desc", () => {
    const triples = [
      {
        vuln: vuln({ identifier: "CVE-LOW-CVSS", cvss_score: 5.0, cisa_kev: false }),
        product: { name: "p", version: "0.1.0" },
      },
      {
        vuln: vuln({ identifier: "CVE-HIGH-CVSS", cvss_score: 9.5, cisa_kev: false }),
        product: { name: "p", version: "0.1.0" },
      },
      {
        vuln: vuln({ identifier: "CVE-KEV", cvss_score: 4.0, cisa_kev: true }),
        product: { name: "p", version: "0.1.0" },
      },
    ];
    const payload = buildMatchesPayload(triples);
    expect(payload.map((m) => m.identifier)).toEqual([
      "CVE-KEV",
      "CVE-HIGH-CVSS",
      "CVE-LOW-CVSS",
    ]);
  });

  it("caps the payload at 500 entries", () => {
    const triples = Array.from({ length: 750 }).map((_, i) => ({
      vuln: vuln({
        id: i,
        identifier: `CVE-${i}`,
        cvss_score: 9.0,
        cisa_kev: false,
      }),
      product: { name: "p", version: "0.1.0" },
    }));
    const payload = buildMatchesPayload(triples);
    expect(payload).toHaveLength(500);
  });

  it("preserves all per-match fields needed by webhook consumers", () => {
    const triple = {
      vuln: vuln({
        identifier: "CVE-2025-6514",
        severity: "critical",
        cvss_score: 9.6,
        cisa_kev: true,
      }),
      product: { name: "mcp-remote", version: "0.5.0" },
    };
    const [m] = buildMatchesPayload([triple]);
    expect(m).toEqual({
      identifier: "CVE-2025-6514",
      package: "mcp-remote",
      version: "0.5.0",
      severity: "critical",
      cvssScore: 9.6,
      cisaKev: true,
    });
  });
});
