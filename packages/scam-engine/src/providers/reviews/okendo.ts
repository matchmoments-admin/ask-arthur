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

/** Recursively collect JSON-LD AggregateRating nodes from a parsed LD block. */
function collectAggregates(
  node: unknown,
  out: { count: number; average: number | null }[],
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectAggregates(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  const agg = obj.aggregateRating as Record<string, unknown> | undefined;
  const isAggType =
    typeof obj["@type"] === "string" &&
    (obj["@type"] as string).toLowerCase() === "aggregaterating";
  const source = isAggType ? obj : agg;
  if (source) {
    const rawCount = source.reviewCount ?? source.ratingCount;
    const count = Number(rawCount);
    const average = source.ratingValue != null ? Number(source.ratingValue) : null;
    if (Number.isFinite(count) && count > 0) {
      out.push({ count, average: Number.isFinite(average) ? average : null });
    }
  }
  for (const value of Object.values(obj)) collectAggregates(value, out);
}

/**
 * Read the exact review count + average from the page's JSON-LD
 * AggregateRating. A store can carry several (per-variant / per-product); the
 * one with the largest count is the product-level aggregate we want.
 */
function parseAggregate(html: string): {
  totalReviews: number | null;
  averageRating: number | null;
} {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const aggregates: { count: number; average: number | null }[] = [];
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
  const best = aggregates.reduce((a, b) => (b.count > a.count ? b : a));
  return { totalReviews: best.count, averageRating: best.average };
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
  let nextPath: string | null = firstPath;

  for (let page = 0; page < MAX_PAGES && nextPath; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const res = await fetchReviewApiJson(`${OKENDO_API_BASE}${nextPath}`, remaining);
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

  const aggregate = parseAggregate(html);
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
