// Okendo review extractor — Deep Shop Check Stage 1 (reviews signal).
//
// Verified live against kouvrfashion.com (2026-07). Okendo exposes a keyless
// public storefront API:
//   GET https://api.okendo.io/v1/stores/{subscriberId}/products/{productId}/reviews?limit=100
// paginated via a relative `nextUrl` (resolve against …/v1). Max 100/page. It
// has NO histogram/summary endpoint and ignores rating filters, so the star
// distribution is built by bounded pagination. The exact review COUNT and
// AVERAGE come for free from the page's JSON-LD AggregateRating (no API call).
//
// Review object fields consumed: rating, title, body, dateCreated,
// reviewer.displayName, reviewer.isVerified. Never throws — returns a typed
// ReviewFetchSkip on any failure.

import type {
  ReviewCorpus,
  ReviewDistribution,
  ReviewFetchSkip,
  SampledReview,
} from "../../reviews-signal";
import type { DetectedReviewApp } from "./detect";
import { fetchReviewApiJson } from "../../fetch-review-api";

const OKENDO_API_BASE = "https://api.okendo.io/v1";
const MAX_PAGES = 12; // 1200 reviews — covers the vast majority of stores fully
const SAMPLE_TEXT_CAP = 40; // reviews handed to the Claude language pass
const TEXT_TRUNCATE = 400;
const TOTAL_BUDGET_MS = 15_000;

interface OkendoReviewer {
  displayName?: string;
  isVerified?: boolean;
}
interface OkendoReview {
  rating?: number;
  title?: string;
  body?: string;
  dateCreated?: string;
  reviewer?: OkendoReviewer;
}
interface OkendoPage {
  reviews?: OkendoReview[];
  nextUrl?: string | null;
}

// Upper bound on a plausible review count — anything larger is a garbage /
// hostile JSON-LD value and would overflow the registry's `integer` column.
const MAX_PLAUSIBLE_REVIEWS = 100_000_000;

interface LdAggregate {
  count: number;
  average: number | null;
  /** True when the aggregate is (or is nested under) a `@type: Product` node. */
  fromProduct: boolean;
}

/** Recursively collect JSON-LD AggregateRating nodes from a parsed LD block. */
function collectAggregates(
  node: unknown,
  out: LdAggregate[],
  parentIsProduct = false,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectAggregates(item, out, parentIsProduct);
    return;
  }
  const obj = node as Record<string, unknown>;
  const typeStr =
    typeof obj["@type"] === "string" ? (obj["@type"] as string).toLowerCase() : "";
  const isProduct = typeStr === "product";
  const agg = obj.aggregateRating as Record<string, unknown> | undefined;
  const isAggType = typeStr === "aggregaterating";
  const source = isAggType ? obj : agg;
  if (source) {
    const rawCount = source.reviewCount ?? source.ratingCount;
    const count = Number(rawCount);
    const average = source.ratingValue != null ? Number(source.ratingValue) : null;
    if (Number.isFinite(count) && count > 0) {
      // A nested aggregateRating is product-scoped when its host node is a
      // Product; a standalone AggregateRating inherits its parent's scope.
      const fromProduct = isAggType ? parentIsProduct : isProduct;
      out.push({
        count,
        average: Number.isFinite(average) ? average : null,
        fromProduct,
      });
    }
  }
  for (const value of Object.values(obj)) {
    collectAggregates(value, out, isProduct || parentIsProduct);
  }
}

function clampAverage(v: number | null): number | null {
  if (v === null) return null;
  return v >= 0 && v <= 5 ? v : null;
}
function clampCount(v: number): number | null {
  return v >= 0 && v <= MAX_PLAUSIBLE_REVIEWS ? Math.round(v) : null;
}

/**
 * Read the exact review count + average from the page's JSON-LD
 * AggregateRating. Values are clamped to sane ranges so a hostile page can't
 * overflow the registry columns.
 *
 * `preferProduct` must be true ONLY when the reviews fetch was product-scoped
 * (so `distribution` covers that one product and a product aggregate is the
 * right total). On a store-wide fetch, preferring a small featured-product
 * aggregate would understate `totalReviews` and make a truncated store-wide
 * sample read as a complete census — defeating the partial-sample guard in
 * scoreReviewDistribution. There we take the largest (store-wide) count.
 */
function parseAggregate(
  html: string,
  preferProduct: boolean,
): {
  totalReviews: number | null;
  averageRating: number | null;
} {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const aggregates: LdAggregate[] = [];
  for (const m of blocks) {
    try {
      collectAggregates(JSON.parse(m[1]), aggregates);
    } catch {
      // A malformed LD block is skipped, not fatal.
    }
  }
  if (aggregates.length === 0) {
    return { totalReviews: null, averageRating: null };
  }
  const products = preferProduct
    ? aggregates.filter((a) => a.fromProduct)
    : [];
  const pool = products.length > 0 ? products : aggregates;
  const best = pool.reduce((a, b) => (b.count > a.count ? b : a));
  return {
    totalReviews: clampCount(best.count),
    averageRating: clampAverage(best.average),
  };
}

function truncate(text: string): string {
  return text.length > TEXT_TRUNCATE ? text.slice(0, TEXT_TRUNCATE) : text;
}

/**
 * Fetch + normalize Okendo reviews. `html` is the already-fetched shop page
 * (reused for the JSON-LD aggregate — no extra request). `detected.productId`
 * selects the product endpoint; without it we fall back to the store-wide feed.
 */
export async function fetchOkendoReviews(
  detected: DetectedReviewApp,
  html: string,
): Promise<ReviewCorpus | ReviewFetchSkip> {
  const sid = detected.identifier;
  const firstPath = detected.productId
    ? `/stores/${sid}/products/${detected.productId}/reviews?limit=100`
    : `/stores/${sid}/reviews?limit=100`;

  const distribution: ReviewDistribution = {
    one: 0,
    two: 0,
    three: 0,
    four: 0,
    five: 0,
  };
  const distKey: Record<number, keyof ReviewDistribution> = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
  };

  const sample: SampledReview[] = [];
  let fetched = 0;
  let verified = 0;
  let verifiedKnown = 0;
  let ratingSum = 0;
  let ratingCount = 0;

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const seen = new Set<string>();
  let nextPath: string | null = firstPath;

  for (let page = 0; page < MAX_PAGES && nextPath; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // Okendo's nextUrl is a "/stores/…" path relative to the /v1 base, so it is
    // appended (NOT resolved via `new URL`, which drops /v1 for a leading-slash
    // path). Guard against an off-host or repeated URL — a self-referential
    // nextUrl would otherwise re-count the same page and inflate the sample
    // past the real count, defeating scoreReviewDistribution's census check.
    const pageUrl = /^https?:\/\//i.test(nextPath)
      ? nextPath
      : `${OKENDO_API_BASE}${nextPath.startsWith("/") ? "" : "/"}${nextPath}`;
    let host: string;
    try {
      host = new URL(pageUrl).host;
    } catch {
      break;
    }
    if (host !== "api.okendo.io" || seen.has(pageUrl)) break;
    seen.add(pageUrl);
    const res = await fetchReviewApiJson(pageUrl, remaining);
    if (res.error || !res.data) {
      // On page 1 a hard failure is a real skip; on later pages we keep what
      // we already have rather than discarding a partial-but-usable corpus.
      if (page === 0) {
        return {
          ok: false,
          reason: res.error === "timeout" ? "timeout" : "http-error",
        };
      }
      break;
    }
    const body = res.data as OkendoPage;
    const reviews = Array.isArray(body.reviews) ? body.reviews : [];
    for (const r of reviews) {
      fetched++;
      const rating = typeof r.rating === "number" ? Math.round(r.rating) : null;
      if (rating && distKey[rating]) {
        distribution[distKey[rating]]++;
        ratingSum += rating;
        ratingCount++;
      }
      if (typeof r.reviewer?.isVerified === "boolean") {
        verifiedKnown++;
        if (r.reviewer.isVerified) verified++;
      }
      if (sample.length < SAMPLE_TEXT_CAP && (r.body || r.title)) {
        sample.push({
          rating,
          text: truncate([r.title, r.body].filter(Boolean).join(" — ")),
          author: r.reviewer?.displayName ?? null,
          date: r.dateCreated ?? null,
          verified: r.reviewer?.isVerified ?? null,
        });
      }
    }
    nextPath = body.nextUrl ?? null;
  }

  if (fetched === 0) {
    return { ok: false, reason: "empty" };
  }

  // Prefer a product aggregate only when we fetched product-scoped reviews.
  const aggregate = parseAggregate(html, detected.productId != null);
  return {
    app: "okendo",
    // Prefer the exact JSON-LD count; fall back to what we fetched.
    totalReviews: aggregate.totalReviews ?? fetched,
    averageRating:
      aggregate.averageRating ??
      (ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null),
    distribution,
    verifiedBuyerRatio: verifiedKnown > 0 ? verified / verifiedKnown : null,
    reviews: sample,
    fetchedFrom: "api.okendo.io",
  };
}
