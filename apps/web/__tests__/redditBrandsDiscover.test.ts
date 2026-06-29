import { describe, expect, it } from "vitest";
import {
  aggregateBrandMentions,
  buildWatchedKeySet,
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
