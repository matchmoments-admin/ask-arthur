import { describe, expect, it } from "vitest";

import {
  scoreReviewDistribution,
  fuseReviewsVerdict,
  type ReviewCorpus,
} from "../reviews-signal";

function corpus(overrides: Partial<ReviewCorpus> = {}): ReviewCorpus {
  return {
    app: "okendo",
    totalReviews: null,
    distribution: null,
    averageRating: null,
    verifiedBuyerRatio: null,
    reviews: [],
    fetchedFrom: "api.okendo.io",
    ...overrides,
  };
}

// The real kouvrfashion.com Okendo distribution: 748 reviews, 4.8★, zero
// 1-star. The motivating case for the whole feature.
const KOUVR = corpus({
  totalReviews: 748,
  averageRating: 4.8,
  distribution: { one: 0, two: 7, three: 15, four: 75, five: 651 },
});

describe("scoreReviewDistribution", () => {
  it("flags the kouvrfashion distribution as implausible (zero 1-star at scale)", () => {
    const { statBand, statReasons } = scoreReviewDistribution(KOUVR, null);
    expect(statBand).toBe("implausible");
    expect(statReasons.join(" ")).toMatch(/1-star/i);
  });

  it("returns plausible for a small store with no low tail (never accuses low-N)", () => {
    // 40 reviews, all 5-star, zero 1-star — below every minimum-N floor.
    const small = corpus({
      totalReviews: 40,
      distribution: { one: 0, two: 0, three: 0, four: 0, five: 40 },
    });
    expect(scoreReviewDistribution(small, null).statBand).toBe("plausible");
  });

  it("returns plausible for a healthy large store with a real low tail", () => {
    const healthy = corpus({
      totalReviews: 800,
      distribution: { one: 20, two: 25, three: 40, four: 200, five: 515 },
    });
    expect(scoreReviewDistribution(healthy, null).statBand).toBe("plausible");
  });

  it("flags an implausibly thin low tail at high N even with a few 1-stars", () => {
    // 500 reviews, 1 one-star + 2 two-star = 0.6% low tail (< 1%).
    const thin = corpus({
      totalReviews: 500,
      distribution: { one: 1, two: 2, three: 7, four: 40, five: 450 },
    });
    expect(scoreReviewDistribution(thin, null).statBand).toBe("implausible");
  });

  it("does NOT fire the absolute low-tail rules on a partial sample", () => {
    // 3000-review store, but only 1200 fetched (Okendo pagination cap). The
    // sample has zero 1-star, but that says nothing about the full corpus —
    // firing would false-positive a large legit store into a permanent mark.
    const partial = corpus({
      totalReviews: 3000,
      distribution: { one: 0, two: 5, three: 40, four: 300, five: 855 }, // sums 1200
    });
    expect(scoreReviewDistribution(partial, null).statBand).toBe("plausible");
  });

  it("DOES fire the same distribution when it is the complete census", () => {
    const complete = corpus({
      totalReviews: 1200,
      distribution: { one: 0, two: 5, three: 40, four: 300, five: 855 },
    });
    expect(scoreReviewDistribution(complete, null).statBand).toBe("implausible");
  });

  it("flags an extreme five-star skew as skewed (not implausible)", () => {
    // 200 reviews, 196 five-star (98%) but with a couple of 1-stars present.
    const skew = corpus({
      totalReviews: 200,
      distribution: { one: 2, two: 0, three: 0, four: 2, five: 196 },
    });
    expect(scoreReviewDistribution(skew, null).statBand).toBe("skewed");
  });

  it("flags review velocity against a young domain (works with null distribution)", () => {
    const fast = corpus({ totalReviews: 300, distribution: null });
    expect(scoreReviewDistribution(fast, 20).statBand).toBe("implausible");
    // Same corpus on an established domain is fine.
    expect(scoreReviewDistribution(fast, 400).statBand).toBe("plausible");
  });

  it("flags a low verified-buyer ratio as skewed", () => {
    const unverified = corpus({
      totalReviews: 300,
      distribution: { one: 5, two: 10, three: 20, four: 80, five: 185 },
      verifiedBuyerRatio: 0.05,
    });
    expect(scoreReviewDistribution(unverified, null).statBand).toBe("skewed");
  });

  it("ignores the verified-buyer rule when the app exposes no such flag", () => {
    const healthy = corpus({
      totalReviews: 300,
      distribution: { one: 5, two: 10, three: 20, four: 80, five: 185 },
      verifiedBuyerRatio: null,
    });
    expect(scoreReviewDistribution(healthy, null).statBand).toBe("plausible");
  });
});

describe("fuseReviewsVerdict", () => {
  it("returns manipulated when implausible stats and the LLM agree", () => {
    expect(fuseReviewsVerdict("implausible", 0.85)).toBe("manipulated");
  });

  it("caps at suspicious on implausible stats alone when the LLM is absent", () => {
    // `manipulated` (the permanent registry mark) requires AI confirmation;
    // without it (flag off / braked / failed → null) the worst is suspicious.
    expect(fuseReviewsVerdict("implausible", null)).toBe("suspicious");
  });

  it("downgrades to suspicious when the LLM disagrees with implausible stats", () => {
    expect(fuseReviewsVerdict("implausible", 0.2)).toBe("suspicious");
  });

  it("returns suspicious for a single weak signal", () => {
    expect(fuseReviewsVerdict("skewed", null)).toBe("suspicious");
    expect(fuseReviewsVerdict("skewed", 0.1)).toBe("suspicious");
    expect(fuseReviewsVerdict("plausible", 0.9)).toBe("suspicious");
  });

  it("returns suspicious (not clean) when two weak signals agree", () => {
    // skewed + high LLM likelihood — inclusive-or, so this doesn't drop to clean.
    expect(fuseReviewsVerdict("skewed", 0.9)).toBe("suspicious");
  });

  it("returns clean when nothing fires", () => {
    expect(fuseReviewsVerdict("plausible", null)).toBe("clean");
    expect(fuseReviewsVerdict("plausible", 0.3)).toBe("clean");
  });

  it("ties the kouvr distribution end-to-end to a manipulated verdict", () => {
    const { statBand } = scoreReviewDistribution(KOUVR, null);
    expect(fuseReviewsVerdict(statBand, 0.8)).toBe("manipulated");
  });
});
