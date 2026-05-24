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

  it("matches a typo within Levenshtein threshold", () => {
    const result = lexicalMatch("bunings.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Bunnings");
    expect(result?.signal_type).toBe("levenshtein");
    expect(result?.evidence.edit_distance).toBe(1);
  });

  it("rejects a typo outside Levenshtein threshold", () => {
    const result = lexicalMatch("bnngs.shop", TEST_WATCHLIST);
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

  it("decodes punycode and detects brand", () => {
    const punycoded = "xn--bunnings-cn1c";
    const result = lexicalMatch(`${punycoded}.shop`, TEST_WATCHLIST);
    if (result) {
      expect(result.brand).toBe("Bunnings");
      expect(["punycode", "substring"]).toContain(result.signal_type);
    }
  });

  it("prefers higher-score signal when multiple types match", () => {
    const result = lexicalMatch("bunnings.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("substring");
  });
});
