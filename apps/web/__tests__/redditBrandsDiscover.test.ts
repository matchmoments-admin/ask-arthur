import { describe, expect, it } from "vitest";
import {
  aggregateBrandMentions,
  buildWatchedKeySet,
  hasAuEvidence,
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

describe("aggregateBrandMentions — AU attribution (v254)", () => {
  it("counts the AU-hinted subset alongside the total", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Telstra"], country_hints: ["AU"] },
      { brands_impersonated: ["Telstra"], country_hints: ["US"] },
      { brands_impersonated: ["Telstra"], country_hints: ["AU", "NZ"] },
    ]);
    expect(agg.get("telstra")).toMatchObject({ mentionCount: 3, auCount: 2 });
  });

  it("treats a missing or empty country_hints as no AU evidence, not as AU", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Xfinity"] },
      { brands_impersonated: ["Xfinity"], country_hints: null },
      { brands_impersonated: ["Xfinity"], country_hints: [] },
    ]);
    expect(agg.get("xfinity")).toMatchObject({ mentionCount: 3, auCount: 0 });
  });

  it("never lets the AU count exceed the total", () => {
    const agg = aggregateBrandMentions([
      // Same brand twice in one post, AU-hinted: one mention, one AU mention.
      { brands_impersonated: ["Optus", "optus"], country_hints: ["AU"] },
    ]);
    const optus = agg.get("optus")!;
    expect(optus.mentionCount).toBe(1);
    expect(optus.auCount).toBeLessThanOrEqual(optus.mentionCount);
  });

  it("attributes AU per-post, not per-brand-list", () => {
    // One AU post naming two brands gives BOTH brands one AU mention.
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Gumtree", "PayPal"], country_hints: ["AU"] },
    ]);
    expect(agg.get("gumtree")?.auCount).toBe(1);
    expect(agg.get("paypal")?.auCount).toBe(1);
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
  const agg = (
    brandNormalized: string,
    rawBrand: string,
    mentionCount: number,
    auCount = 0,
  ) => ({ brandNormalized, rawBrand, mentionCount, auCount });

  it("sums counts for a brand seen in BOTH sources (scam never clobbers reddit)", () => {
    const merged = mergeCandidateSources(
      [agg("telstra", "Telstra", 4, 1)],
      [agg("telstra", "telstra", 3, 3)],
    );
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.reddit).toBe(4);
    expect(m.scam).toBe(3);
    expect(m.total).toBe(7);
    // AU counts sum across sources too — 1 AU-hinted Reddit post plus 3
    // AU-native reports.
    expect(m.au).toBe(4);
    // Reddit's raw string is kept as the representative.
    expect(m.rawBrand).toBe("Telstra");
  });

  it("keeps reddit-only and scam-only brands with the other source at 0", () => {
    const merged = mergeCandidateSources(
      [agg("hinge", "Hinge", 3)],
      [agg("depop", "Depop", 5, 5)],
    );
    const byKey = Object.fromEntries(merged.map((m) => [m.brandNormalized, m]));
    expect(byKey.hinge).toMatchObject({ reddit: 3, scam: 0, total: 3, au: 0 });
    expect(byKey.depop).toMatchObject({ reddit: 0, scam: 5, total: 5, au: 5 });
  });

  it("returns an empty list when neither source has candidates", () => {
    expect(mergeCandidateSources([], [])).toEqual([]);
  });

  it("passes scam candidates through unchanged when the reddit list is empty", () => {
    const merged = mergeCandidateSources([], [agg("depop", "Depop", 5, 5)]);
    expect(merged).toEqual([
      {
        brandNormalized: "depop",
        rawBrand: "Depop",
        reddit: 0,
        scam: 5,
        total: 5,
        au: 5,
      },
    ]);
  });
});

describe("hasAuEvidence — what reaches the actionable digest", () => {
  const cand = (rawBrand: string, total: number, au: number) => ({
    brandNormalized: brandNormalize(rawBrand)!,
    rawBrand,
    reddit: total,
    scam: 0,
    total,
    au,
  });

  it("silences the 2026-07-26 digest's US-only proposals", () => {
    // The five brands the digest actually asked a human to consider adding to
    // an AUSTRALIAN watchlist, each at exactly the ≥3 mention floor with zero
    // AU-hinted posts behind them.
    for (const brand of ["Xfinity", "NextDoor", "Chime", "American Express"]) {
      expect(hasAuEvidence(cand(brand, 3, 0))).toBe(false);
    }
  });

  it("admits a brand with even a single AU-attributable mention", () => {
    // Measured ceiling for AU evidence in a 30d window is 2 posts, so the bar
    // has to be 1 — anything higher is a permanent zero.
    expect(hasAuEvidence(cand("Capital One", 3, 1))).toBe(true);
    expect(hasAuEvidence(cand("Vinted", 4, 1))).toBe(true);
  });

  it("does not admit a high-volume global brand on volume alone", () => {
    // 28 mentions is a fact about r/Scams traffic, not about Australia.
    expect(hasAuEvidence(cand("Walmart", 17, 0))).toBe(false);
  });

  it("admits an AU-native reported brand with low global volume", () => {
    // The whole point of the scam_reports source: 2 Australian users beats
    // 28 Americans for deciding what an AU watchlist should monitor.
    const reported = { ...cand("Australia Post", 2, 2), reddit: 0, scam: 2 };
    expect(hasAuEvidence(reported)).toBe(true);
  });
});

describe("CANDIDATE_DENYLIST", () => {
  it("still denies platform names the classifier mis-tags as impersonated", () => {
    for (const noise of [
      "Reddit",
      "Discord",
      "LinkedIn",
      "Facebook Marketplace",
      "Meta",
      "TikTok",
    ]) {
      expect(CANDIDATE_DENYLIST.has(brandNormalize(noise))).toBe(true);
    }
  });

  it("matches the label the classifier emits, not the one a human would write", () => {
    // "X (Twitter)" normalises to "xtwitter", which neither the "X" entry
    // ("x") nor the "Twitter" entry ("twitter") covers. It sat pending in the
    // queue for a month because of that gap.
    expect(brandNormalize("X (Twitter)")).toBe("xtwitter");
    expect(CANDIDATE_DENYLIST.has(brandNormalize("X (Twitter)"))).toBe(true);
  });

  it("no longer hand-maintains a US-brand blocklist", () => {
    // These were denylisted by hand until v254. They are now handled by AU
    // evidence instead — the list was a worse version of a column we already
    // populate, and it was losing: Walmart, Verizon, USPS, Lowe's, Costco,
    // Xfinity, Chime and Capital One all sailed past it into the digest.
    for (const usBrand of [
      "Cash App",
      "Venmo",
      "Zelle",
      "Wells Fargo",
      "Bank of America",
      "Chase",
      "Robinhood",
      "MrBeast",
    ]) {
      expect(CANDIDATE_DENYLIST.has(brandNormalize(usBrand))).toBe(false);
    }
  });

  it("does not denylist legitimate AU brands", () => {
    for (const keep of ["Australia Post", "CommBank", "Telstra", "NAB"]) {
      expect(CANDIDATE_DENYLIST.has(brandNormalize(keep))).toBe(false);
    }
  });
});
