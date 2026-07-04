// On-page review-authenticity scoring — Deep Shop Check Stage 1.
//
// Two pure functions, no I/O (the fetch/extract lives in providers/reviews/):
//   1. scoreReviewDistribution — a transparent deterministic check over the
//      review corpus (star distribution, review velocity vs domain age,
//      verified-buyer ratio). Mirrors the explainable philosophy of
//      shop-check-score.ts — no opaque ML score.
//   2. fuseReviewsVerdict — combines the deterministic band with an optional
//      Claude language-pass likelihood into the single enum the composite
//      score consumes.
//
// Guiding rule: insufficient evidence is NEVER an accusation. Every rule is
// gated behind a minimum review count so a small, genuinely-loved store is
// never flagged — it simply returns `plausible` / `clean`.
//
// Pure — unit-tested in __tests__/reviews-signal.test.ts.

/** Star-count distribution, keyed one..five (JSON-safe identifier keys). */
export interface ReviewDistribution {
  one: number;
  two: number;
  three: number;
  four: number;
  five: number;
}

/** A single sampled review, bounded by the adapter before it reaches here. */
export interface SampledReview {
  rating: number | null;
  text: string;
  author: string | null;
  date: string | null;
  verified: boolean | null;
}

/** Supported on-page review apps. */
export type ReviewApp = "okendo" | "judgeme" | "loox" | "yotpo";

/**
 * Normalized review data from a supported app. Produced by
 * providers/reviews/* (PR 2); `distribution` / `verifiedBuyerRatio` are null
 * when the app exposes no aggregate/verification endpoint.
 */
export interface ReviewCorpus {
  app: ReviewApp;
  totalReviews: number | null;
  distribution: ReviewDistribution | null;
  averageRating: number | null;
  verifiedBuyerRatio: number | null;
  /** Bounded sample for the Claude language pass (≤40, text truncated). */
  reviews: SampledReview[];
  /** Endpoint host the corpus was read from — surfaced for transparency. */
  fetchedFrom: string;
}

/** Typed non-result — the review signal is unavailable, never an error throw. */
export interface ReviewFetchSkip {
  ok: false;
  reason:
    | "flag-off"
    | "unsupported-app"
    | "no-fingerprint"
    | "no-identifier"
    | "http-error"
    | "timeout"
    | "empty";
}

export type StatBand = "implausible" | "skewed" | "plausible";

export interface DistributionScore {
  statBand: StatBand;
  statReasons: string[];
}

// Minimum review counts before a rule may fire. Below these, the store has
// too little data to draw any inference — always `plausible`.
const MIN_N_ZERO_ONE_STAR = 200; // for the "not a single 1-star" rule
const MIN_N_THIN_TAIL = 300; // for the proportional low-tail rule
const MIN_N_SKEW = 100;
const MIN_N_VERIFIED = 100;

// Thresholds.
const THIN_TAIL_RATIO = 0.01; // <1% one+two-star at high N is implausible
const EXTREME_SKEW_RATIO = 0.97; // >97% five-star
const LOW_VERIFIED_RATIO = 0.2; // <20% verified buyers at high N
const VELOCITY_MIN_REVIEWS = 200;
const VELOCITY_MAX_DOMAIN_DAYS = 90;

function distributionTotal(d: ReviewDistribution): number {
  return d.one + d.two + d.three + d.four + d.five;
}

/**
 * Score the deterministic implausibility of a review corpus. `domainAgeDays`
 * is the value already computed by the deep-check `domain-age` step (null when
 * WHOIS was unavailable) — reused so the velocity rule needs no extra I/O.
 */
export function scoreReviewDistribution(
  corpus: ReviewCorpus,
  domainAgeDays: number | null,
): DistributionScore {
  const reasons: string[] = [];
  let implausible = false;
  let skewed = false;

  const dist = corpus.distribution;
  const distN = dist ? distributionTotal(dist) : 0;

  // The absolute low-tail rules below assert facts about the WHOLE corpus
  // ("not a single 1-star"), so they may only fire on a complete census. When
  // a store has more reviews than we fetched (the Okendo pagination cap), the
  // distribution is a recency-biased slice and "zero 1-star" in the slice says
  // nothing about the full set — firing here would false-positive a large,
  // legitimate store into a permanent registry mark. Ratio-based rules (skew,
  // verified) stay representative on a sample, so only 1a/1b are gated.
  const isCompleteCensus =
    corpus.totalReviews === null || distN >= corpus.totalReviews;

  // Rule 1 — missing low tail. Two variants, because seeded/imported review
  // sets characteristically lack the unhappy-customer tail a genuine large
  // corpus accumulates (the kouvrfashion case: 748 reviews, zero 1-star, only
  // 7 two-star = 0.9% low tail).
  //   1a: not a single 1-star review across ≥200 reviews.
  //   1b: <1% of ≥300 reviews sit in the bottom two bands.
  if (dist && isCompleteCensus) {
    const lowTail = dist.one + dist.two;
    if (distN >= MIN_N_ZERO_ONE_STAR && dist.one === 0) {
      implausible = true;
      reasons.push(
        `Not a single 1-star review across ${distN} reviews — genuine stores this size almost always have some`,
      );
    }
    if (distN >= MIN_N_THIN_TAIL && lowTail / distN < THIN_TAIL_RATIO) {
      implausible = true;
      reasons.push(
        `Only ${lowTail} of ${distN} reviews are 1- or 2-star (${(
          (lowTail / distN) *
          100
        ).toFixed(1)}%) — an implausibly small low-star tail`,
      );
    }
  }

  // Rule 2 — extreme five-star skew.
  if (dist && distN >= MIN_N_SKEW) {
    const fiveRatio = dist.five / distN;
    if (fiveRatio > EXTREME_SKEW_RATIO) {
      skewed = true;
      reasons.push(
        `${Math.round(fiveRatio * 100)}% of reviews are 5-star — an unusually uniform rating`,
      );
    }
  }

  // Rule 3 — review velocity vs domain age. Works even when `distribution` is
  // null (some apps expose only a total), so it carries those apps.
  if (
    corpus.totalReviews !== null &&
    corpus.totalReviews > VELOCITY_MIN_REVIEWS &&
    domainAgeDays !== null &&
    domainAgeDays < VELOCITY_MAX_DOMAIN_DAYS
  ) {
    implausible = true;
    reasons.push(
      `${corpus.totalReviews} reviews on a domain only ${domainAgeDays} days old — an implausibly fast accumulation`,
    );
  }

  // Rule 4 — verified-buyer anomaly. Seeded/imported reviews rarely carry
  // order-backed verification. Skipped when the app exposes no such flag.
  if (
    corpus.verifiedBuyerRatio !== null &&
    distN >= MIN_N_VERIFIED &&
    corpus.verifiedBuyerRatio < LOW_VERIFIED_RATIO
  ) {
    skewed = true;
    reasons.push(
      `Only ${Math.round(corpus.verifiedBuyerRatio * 100)}% of reviews are from verified buyers`,
    );
  }

  const statBand: StatBand = implausible
    ? "implausible"
    : skewed
      ? "skewed"
      : "plausible";
  return { statBand, statReasons: reasons };
}

export type ReviewsVerdict = "clean" | "suspicious" | "manipulated";

const FAKE_LIKELIHOOD_THRESHOLD = 0.7;

/**
 * Fuse the deterministic band with the optional Claude language likelihood.
 *
 * Two-key design — the strongest verdict (`manipulated`) requires the
 * statistics AND the language pass to AGREE. `manipulated` is the only verdict
 * that writes a permanent, no-TTL mark to the community reputation registry,
 * so it must never rest on statistics alone: without an affirmative LLM
 * confirmation (flag off, braked, timed out, or failed → likelihood null) the
 * worst we return is `suspicious`. This makes the registry trustworthy and
 * means a transient LLM failure can't escalate a store to a permanent flag.
 *   - manipulated: `implausible` distribution AND the LLM agrees (≥0.7).
 *   - suspicious: a single concern present (a stat concern OR a high LLM
 *     likelihood) that didn't rise to `manipulated`.
 *   - clean: no concern.
 */
export function fuseReviewsVerdict(
  statBand: StatBand,
  fakeLikelihood: number | null,
): ReviewsVerdict {
  const llmFake =
    fakeLikelihood !== null && fakeLikelihood >= FAKE_LIKELIHOOD_THRESHOLD;
  const statConcern = statBand === "implausible" || statBand === "skewed";

  if (statBand === "implausible" && llmFake) {
    return "manipulated";
  }
  if (statConcern || llmFake) {
    return "suspicious";
  }
  return "clean";
}
