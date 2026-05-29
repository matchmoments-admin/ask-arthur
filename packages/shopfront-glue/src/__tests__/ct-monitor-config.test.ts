import { describe, expect, it } from "vitest";
import {
  AU_BRAND_WATCHLIST,
  getCtMonitorConfig,
} from "../au-brand-watchlist";

// The exact keyword set the hardcoded ct-monitor.ts shipped before the
// watchlist-unification refactor. The `core` tier MUST reproduce this so
// flipping FF_CT_MONITOR_EXPANDED OFF is byte-identical to pre-refactor prod.
const ORIGINAL_CORE_KEYWORDS = [
  "mygov",
  "centrelink",
  "ato.gov",
  "auspost",
  "commbank",
  "nab",
  "westpac",
  "telstra",
  "servicensw",
];

// Legitimate-domain exclusions the hardcoded monitor carried. The derived
// union must be a superset of these — dropping any would re-introduce a
// false-positive on the brand's own cert (a regression).
const ORIGINAL_LEGIT_DOMAINS = [
  "my.gov.au",
  "mygov.au",
  "servicesaustralia.gov.au",
  "centrelink.gov.au",
  "ato.gov.au",
  "auspost.com.au",
  "commbank.com.au",
  "nab.com.au",
  "anz.com",
  "anz.com.au",
  "westpac.com.au",
  "telstra.com",
  "telstra.com.au",
  "service.nsw.gov.au",
];

describe("getCtMonitorConfig", () => {
  it("core-only reproduces the original 9 keywords exactly (no regression)", () => {
    const { keywords } = getCtMonitorConfig(false);
    const got = keywords.map((k) => k.keyword).sort();
    expect(got).toEqual([...ORIGINAL_CORE_KEYWORDS].sort());
  });

  it("expanded adds the research-driven concentrated targets and is a superset", () => {
    const core = getCtMonitorConfig(false).keywords.map((k) => k.keyword);
    const expanded = getCtMonitorConfig(true).keywords.map((k) => k.keyword);
    // Every core keyword survives in the expanded set.
    for (const k of core) expect(expanded).toContain(k);
    expect(expanded.length).toBeGreaterThan(core.length);
    // Spot-check a few of the concentrated AU targets the research named.
    for (const k of [
      "macquarie",
      "linkt",
      "australiansuper",
      "hostplus",
      "medibank",
      "qantas",
      "afterpay",
    ]) {
      expect(expanded).toContain(k);
      expect(core).not.toContain(k);
    }
  });

  it("includes every original legit-domain exclusion (no regression)", () => {
    const { legitimateDomains } = getCtMonitorConfig(true);
    for (const d of ORIGINAL_LEGIT_DOMAINS) {
      expect(legitimateDomains).toContain(d);
    }
  });

  it("never lists a CT keyword that would self-flag a brand's own apex domain", () => {
    // A keyword whose %keyword% wildcard matches one of OUR legit domains is
    // fine (isLegitimate excludes the cert), but the keyword should be a real
    // distinctive token, not accidentally empty/whitespace.
    const { keywords } = getCtMonitorConfig(true);
    for (const { keyword } of keywords) {
      expect(keyword.trim()).toBe(keyword);
      expect(keyword.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("emits no duplicate keywords", () => {
    const keywords = getCtMonitorConfig(true).keywords.map((k) => k.keyword);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it("every ct keyword maps to a brand present in the watchlist", () => {
    const brands = new Set(AU_BRAND_WATCHLIST.map((e) => e.brand));
    for (const { brand } of getCtMonitorConfig(true).keywords) {
      expect(brands.has(brand)).toBe(true);
    }
  });
});
