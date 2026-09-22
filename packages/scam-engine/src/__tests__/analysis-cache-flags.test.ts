import { describe, it, expect, vi } from "vitest";

// analyzeOutputAffectingFlags is the ONE list of flags both analyze call sites
// key the cache on. Two properties matter:
//   1. flipping FF_ANALYZE_FIRST_PARTY_URLS ON re-keys (no stale SAFE replay of
//      a URL that is now a known Weaponised clone);
//   2. shipping it dark leaves every existing key untouched (no cache-miss storm
//      = no burst of Claude spend on deploy).
const flags = { asicLookup: false, analyzeFirstPartyUrls: false };
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));

const { analyzeOutputAffectingFlags, buildAnalyzeCacheKey } = await import("../analysis-cache");

describe("analyzeOutputAffectingFlags", () => {
  it("flag OFF: identical to the pre-existing { asicLookup } shape", async () => {
    flags.analyzeFirstPartyUrls = false;
    expect(analyzeOutputAffectingFlags()).toEqual({ asicLookup: false });
    const before = await buildAnalyzeCacheKey({ text: "x", outputAffectingFlags: { asicLookup: false } });
    const now = await buildAnalyzeCacheKey({ text: "x", outputAffectingFlags: analyzeOutputAffectingFlags() });
    expect(now).toBe(before);
  });

  it("flag ON: re-keys the cache", async () => {
    flags.analyzeFirstPartyUrls = false;
    const off = await buildAnalyzeCacheKey({ text: "x", outputAffectingFlags: analyzeOutputAffectingFlags() });
    flags.analyzeFirstPartyUrls = true;
    expect(analyzeOutputAffectingFlags()).toEqual({ asicLookup: false, firstPartyUrls: true });
    const on = await buildAnalyzeCacheKey({ text: "x", outputAffectingFlags: analyzeOutputAffectingFlags() });
    expect(on).not.toBe(off);
  });
});
