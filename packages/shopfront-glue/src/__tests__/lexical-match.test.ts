import { describe, expect, it } from "vitest";
import { lexicalMatch } from "../lexical-match";
import type { BrandEntry } from "../au-brand-watchlist";

const TEST_WATCHLIST: BrandEntry[] = [
  { brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] },
  { brand: "Westpac", legitimate_domains: ["westpac.com.au"] },
  { brand: "JB Hi-Fi", legitimate_domains: ["jbhifi.com.au"] },
];

describe("lexicalMatch", () => {
  it("returns null for an exact legitimate domain", () => {
    expect(lexicalMatch("bunnings.com.au", TEST_WATCHLIST)).toBeNull();
  });

  it("returns null for an unrelated domain", () => {
    expect(lexicalMatch("example.com", TEST_WATCHLIST)).toBeNull();
  });

  it("matches a brand substring in the primary label", () => {
    const result = lexicalMatch("bunnings-au-deals.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Bunnings");
    expect(result?.signal_type).toBe("substring");
  });

  it("matches a single-edit typo (Levenshtein distance 1)", () => {
    const result = lexicalMatch("bunings.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Bunnings");
    expect(result?.signal_type).toBe("levenshtein");
    expect(result?.evidence.edit_distance).toBe(1);
  });

  it("rejects a 2-edit typo (threshold=1 lowers FP rate on legit AU domains)", () => {
    // 'bunnnigs' is distance 2 from 'bunnings' — threshold=1 means no fire.
    // This is the defamation-defence boundary: `bondi.com.au` (dist 1 from
    // Bonds is still a hit), but distance-2 dictionary words (`bonded.com`,
    // `targets.shop`, `subwy.com`) are out.
    const result = lexicalMatch("bunnnigs.shop", TEST_WATCHLIST);
    expect(result).toBeNull();
  });

  it("normalises confusables (cyrillic 'а' → latin 'a')", () => {
    const result = lexicalMatch("westpаc-login.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Westpac");
    expect(result?.signal_type).toBe("confusable");
  });

  it("strips non-alphanumerics from brand for matching", () => {
    const result = lexicalMatch("jbhifi-au.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("JB Hi-Fi");
  });

  it("does not Levenshtein-match brands shorter than 5 chars", () => {
    const shortList: BrandEntry[] = [
      { brand: "KFC", legitimate_domains: ["kfc.com.au"] },
    ];
    const result = lexicalMatch("kfd.shop", shortList);
    expect(result).toBeNull();
  });

  it("substring-matches an A-label that contains the brand string", () => {
    // We do NOT decode IDN at MVP — Node's URL constructor doesn't decode
    // punycode A-labels to Unicode. Instead we rely on the brand appearing
    // as a substring of the raw label (xn--bunnings-cn1c.shop contains
    // "bunnings"). Real IDN homograph handling is Phase B scope.
    const result = lexicalMatch("xn--bunnings-cn1c.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Bunnings");
    expect(result?.signal_type).toBe("substring");
  });

  it("prefers higher-score signal when multiple types match", () => {
    const result = lexicalMatch("bunnings.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("substring");
  });

  it("never returns score >= 1.0 (cap below `medium` severity boundary)", () => {
    // Per #376 severity formula `round(score * 40)`, score >= 1.0 would map
    // to severity 40 = `medium` tier, violating the MVP cap. Confusable is
    // the highest signal at 0.9 → severity 36 → low. Defence-in-depth: if
    // a future signal pushes score above 0.95 the matcher clamps.
    const probes = [
      "bunnings.shop",
      "bunings.shop",
      "westpаc-login.shop",
      "jbhifi-au.shop",
    ];
    for (const probe of probes) {
      const result = lexicalMatch(probe, TEST_WATCHLIST);
      if (result) {
        expect(result.score).toBeLessThan(1.0);
      }
    }
  });
});
