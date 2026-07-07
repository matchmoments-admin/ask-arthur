import { describe, it, expect } from "vitest";
import {
  PARTNER_FRAMING,
  resolvePartnerType,
  resolveJurisdiction,
  regionToStateCode,
  tallyRanked,
  AU_JURISDICTIONS,
} from "./framing";

describe("partner framing", () => {
  it("resolves known partner types and defaults unknown to police", () => {
    expect(resolvePartnerType("police")).toBe("police");
    expect(resolvePartnerType("BANK")).toBe("bank");
    expect(resolvePartnerType("nonsense")).toBe("police");
    expect(resolvePartnerType(null)).toBe("police");
    expect(resolvePartnerType(undefined)).toBe("police");
  });

  it("resolves valid AU jurisdictions and rejects others", () => {
    expect(resolveJurisdiction("nsw")).toBe("NSW");
    expect(resolveJurisdiction("VIC")).toBe("VIC");
    expect(resolveJurisdiction("XYZ")).toBeNull();
    expect(resolveJurisdiction(null)).toBeNull();
  });

  it("every framing has panels, pillars, and a governance note", () => {
    for (const f of Object.values(PARTNER_FRAMING)) {
      expect(f.panels.length).toBeGreaterThan(0);
      expect(f.pillars.length).toBeGreaterThan(0);
      expect(f.governanceNote.length).toBeGreaterThan(0);
      // Governance note must keep the de-identified promise explicit.
      expect(f.governanceNote.toLowerCase()).toContain("de-identified");
    }
  });

  it("exposes all eight AU jurisdictions", () => {
    expect(AU_JURISDICTIONS).toHaveLength(8);
    expect(AU_JURISDICTIONS).toContain("NSW");
    expect(AU_JURISDICTIONS).toContain("ACT");
  });
});

describe("regionToStateCode (tolerant of both stored region forms)", () => {
  it("maps full-name regions", () => {
    expect(regionToStateCode("Sydney, New South Wales")).toBe("NSW");
    expect(regionToStateCode("Macquarie Park, New South Wales")).toBe("NSW");
    expect(regionToStateCode("Melbourne, Victoria")).toBe("VIC");
  });

  it("maps state-code regions (the form parseStateFromRegion misses)", () => {
    // Real prod data — the largest NSW bucket is stored this way; without the
    // code fallback it would be dropped (measured 4× undercount).
    expect(regionToStateCode("Sydney, NSW")).toBe("NSW");
    expect(regionToStateCode("Melbourne, VIC")).toBe("VIC");
  });

  it("returns null for country-only and non-AU regions", () => {
    expect(regionToStateCode("AU")).toBeNull();
    expect(regionToStateCode("KR")).toBeNull();
    expect(regionToStateCode("Lo Prado, Santiago Metropolitan")).toBeNull();
    expect(regionToStateCode(null)).toBeNull();
  });
});

describe("tallyRanked (daily-summary arrays → ranked top-N)", () => {
  it("ranks by frequency, ties break alphabetically", () => {
    const out = tallyRanked([
      ["phishing", "impersonation"],
      ["impersonation"],
      ["impersonation", "investment"],
      ["investment"],
    ]);
    expect(out[0]).toEqual({ name: "impersonation", count: 3 });
    expect(out[1]).toEqual({ name: "investment", count: 2 });
    expect(out[2]).toEqual({ name: "phishing", count: 1 });
  });

  it("ignores null rows and blank entries, and honours the limit", () => {
    const out = tallyRanked([null, ["ATO"], [""], undefined, ["ATO"], ["myGov"]], 1);
    expect(out).toEqual([{ name: "ATO", count: 2 }]);
  });

  it("returns empty for no data", () => {
    expect(tallyRanked([])).toEqual([]);
    expect(tallyRanked([null, undefined])).toEqual([]);
  });
});
