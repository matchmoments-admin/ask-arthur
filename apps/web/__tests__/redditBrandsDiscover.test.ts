import { describe, expect, it } from "vitest";
import {
  aggregateBrandMentions,
  buildWatchedKeySet,
  mergeCandidateSources,
  CANDIDATE_DENYLIST,
} from "@/app/api/inngest/functions/reddit-brands-discover";
import { brandNormalize } from "@askarthur/shopfront-glue";

describe("aggregateBrandMentions", () => {
  it("counts one mention per distinct normalized brand per post", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["CommBank", "ANZ"] },
      { brands_impersonated: ["commbank", "Telstra"] }, // commbank normalizes same as CommBank
      { brands_impersonated: null },
    ]);
    expect(agg.get("commbank")?.mentionCount).toBe(2);
    expect(agg.get("anz")?.mentionCount).toBe(1);
    expect(agg.get("telstra")?.mentionCount).toBe(1);
  });

  it("dedupes a brand listed twice in the same post", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Australia Post", "Australia Post", "auspost"] },
    ]);
    // "Australia Post" (x2) and "auspost" normalize differently, but the two
    // "Australia Post" entries in one post count once.
    expect(agg.get("australiapost")?.mentionCount).toBe(1);
    expect(agg.get("auspost")?.mentionCount).toBe(1);
  });

  it("keeps a representative raw string and ignores empty/symbol-only entries", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["  NAB  ", "!!!", ""] },
    ]);
    expect(agg.get("nab")?.rawBrand).toBe("NAB");
    expect(agg.size).toBe(1); // "!!!" and "" normalize to null → skipped
  });
});

describe("buildWatchedKeySet", () => {
  it("includes canonical brand names AND aliases, normalized", () => {
    const set = buildWatchedKeySet([
      { brand: "Commonwealth Bank", aliases: ["CommBank", "CBA"] },
      { brand: "Australia Post" },
    ]);
    expect(set.has("commonwealthbank")).toBe(true);
    expect(set.has("commbank")).toBe(true);
    expect(set.has("cba")).toBe(true);
    expect(set.has("australiapost")).toBe(true);
    expect(set.has("anz")).toBe(false);
  });
});

describe("mergeCandidateSources (multi-source watchlist_candidates, Phase 1)", () => {
  const agg = (brandNormalized: string, rawBrand: string, mentionCount: number) => ({
    brandNormalized,
    rawBrand,
    mentionCount,
  });

  it("sums counts for a brand seen in BOTH sources (scam never clobbers reddit)", () => {
    const merged = mergeCandidateSources(
      [agg("telstra", "Telstra", 4)],
      [agg("telstra", "telstra", 3)],
    );
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.reddit).toBe(4);
    expect(m.scam).toBe(3);
    expect(m.total).toBe(7);
    // Reddit's raw string is kept as the representative.
    expect(m.rawBrand).toBe("Telstra");
  });

  it("keeps reddit-only and scam-only brands with the other source at 0", () => {
    const merged = mergeCandidateSources(
      [agg("hinge", "Hinge", 3)],
      [agg("depop", "Depop", 5)],
    );
    const byKey = Object.fromEntries(merged.map((m) => [m.brandNormalized, m]));
    expect(byKey.hinge).toMatchObject({ reddit: 3, scam: 0, total: 3 });
    expect(byKey.depop).toMatchObject({ reddit: 0, scam: 5, total: 5 });
  });

  it("returns an empty list when neither source has candidates", () => {
    expect(mergeCandidateSources([], [])).toEqual([]);
  });

  it("passes scam candidates through unchanged when the reddit list is empty", () => {
    const merged = mergeCandidateSources([], [agg("depop", "Depop", 5)]);
    expect(merged).toEqual([
      { brandNormalized: "depop", rawBrand: "Depop", reddit: 0, scam: 5, total: 5 },
    ]);
  });
});

describe("CANDIDATE_DENYLIST", () => {
  it("matches the noise brands seen in the digest (platforms + US-only)", () => {
    for (const noise of [
      "Reddit",
      "Discord",
      "LinkedIn",
      "Facebook Marketplace",
      "Meta",
      "TikTok",
      "Cash App",
      "Venmo",
      "Wells Fargo",
      "Bank of America",
    ]) {
      expect(CANDIDATE_DENYLIST.has(brandNormalize(noise))).toBe(true);
    }
  });

  it("does not denylist legitimate AU brands", () => {
    for (const keep of ["Australia Post", "CommBank", "Telstra", "NAB"]) {
      expect(CANDIDATE_DENYLIST.has(brandNormalize(keep))).toBe(false);
    }
  });
});
