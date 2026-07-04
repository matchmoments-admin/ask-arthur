// shop-signal-enrich — Deep Shop Check enrichment Inngest function.
//
// Consumes shop.check.requested.v1 (emitted by POST /api/shop-check on a
// user click). Runs the three Stage-1 signals — ABN verification, WHOIS
// domain age, APIVoid Site Trustworthiness — computes a transparent
// composite score, and writes the result back onto the shop_checks row the
// client is polling via GET /api/shop-check/[id].
//
// Expected duration: ~5–60s (page fetch ~6s — up to ~16s when the ABN is
// not on the homepage and verifyShopAbnDeep walks /about-/terms-style
// candidate pages — + WHOIS 5s + ABR 10s + APIVoid 10s + reviews ~6s page
// fetch plus bounded review-app pagination, mostly sequential). Well under
// the 5-min Inngest budget and the 10-min pg-stuck-query-watchdog horizon —
// the only DB work is three small RPC calls.
//
// Every enrichment adapter degrades gracefully (null/empty, never throws),
// so a "failed" run is almost always a successful `complete` with partial
// data. The only genuine failure is the Supabase write-back; that step
// throws so Inngest retries it.
//
// The enrichment body is factored into runShopSignalEnrich() so the
// partial-signal degradation paths are unit-testable with a stub step —
// the createFunction wrapper is a thin shell. See
// __tests__/shop-signal-enrich.test.ts.
//
// Plan: docs/plans/shop-guard-v2.md §4.
// ADR: docs/adr/0008-shop-signal-deep-check-user-initiated.md.

import { inngest } from "./client";
import { withAxiomLogging } from "./with-axiom-logging";
import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import type {
  ShopCheckBand,
  ShopCheckEnrichment,
  ShopCheckReviews,
  Verdict,
} from "@askarthur/types";
import {
  SHOP_CHECK_REQUESTED_EVENT,
  parseShopCheckRequestedData,
} from "./events";
import { verifyShopAbnDeep } from "../abn-extract";
import {
  getDomainCreatedDate,
  domainAgeDays,
  domainAgeBand,
} from "../whois-cached";
import { getSiteTrustworthiness } from "../providers/apivoid";
import { computeCompositeScore, bandToVerdict } from "../shop-check-score";
import { extractDomain } from "../url-normalize";
import { fetchShopPage } from "../fetch-shop-page";
import { detectAndFetchReviews } from "../providers/reviews";
import { assessReviewLanguage } from "../providers/reviews/language";
import {
  scoreReviewDistribution,
  fuseReviewsVerdict,
} from "../reviews-signal";
import { isFeatureBraked } from "../cost-log";

/** Merge a deepCheck patch into shop_checks.signal. Throws on RPC error. */
async function writeDeepCheck(
  id: string,
  deepCheck: ShopCheckEnrichment,
  compositeScore?: number,
  verdict?: Verdict,
): Promise<boolean> {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("supabase client unavailable");
  const args: Record<string, unknown> = { p_id: id, p_patch: { deepCheck } };
  if (compositeScore !== undefined) args.p_composite_score = compositeScore;
  if (verdict !== undefined) args.p_verdict = verdict;
  const { data, error } = await supabase.rpc("update_shop_check_signal", args);
  if (error) {
    throw new Error(`update_shop_check_signal failed: ${error.message}`);
  }
  return data === true;
}

/**
 * Best-effort: record a concerning on-page review finding in the durable
 * per-domain registry (shop_review_findings) that backs community reputation
 * warnings. Only suspicious/manipulated verdicts are registered — a clean
 * store never creates a warning entry. Unlike shop_checks (per-click, 90-day
 * TTL) this is deduped by domain and never expires; the RPC keeps the worst
 * verdict ever seen. Never throws — a registry failure must not fail the check.
 */
async function registerReviewFinding(
  url: string,
  reviews: ShopCheckReviews,
  compositeScore: number,
): Promise<void> {
  if (reviews.verdict !== "suspicious" && reviews.verdict !== "manipulated") {
    return;
  }
  const domain = extractDomain(url);
  if (!domain) return;
  const supabase = createServiceClient();
  if (!supabase) return;
  const { error } = await supabase.rpc("upsert_shop_review_finding", {
    p_domain: domain,
    p_review_app: reviews.app,
    p_verdict: reviews.verdict,
    p_total_reviews: reviews.totalReviews,
    p_average_rating: reviews.averageRating,
    p_distribution: reviews.distribution,
    p_fake_likelihood: reviews.fakeLikelihood,
    p_composite_score: compositeScore,
    p_reasons: reviews.reasons,
    p_sample_url: url,
  });
  if (error) {
    logger.warn("shop-signal-enrich: review-finding upsert failed", {
      domain,
      error: error.message,
    });
  }
}

/**
 * The minimal `step` surface runShopSignalEnrich depends on. Inngest's real
 * `step` satisfies it structurally; tests pass a synchronous pass-through
 * stub. Kept local because Inngest's own step type is more constrained
 * (it Jsonify-types step output), so the createFunction wrapper casts to it.
 */
interface EnrichStep {
  run<T>(id: string, fn: () => T | Promise<T>): Promise<T>;
}

/**
 * Core Deep Shop Check enrichment, factored out of the Inngest wrapper so
 * the partial-signal degradation paths are unit-testable with a stub step.
 */
export async function runShopSignalEnrich(
  step: EnrichStep,
  rawEventData: unknown,
): Promise<{ shopCheckId: string; score: number; band: ShopCheckBand }> {
  // Inline (not a step.run): pure deterministic Zod parse, free to re-run on
  // retry — memoising it as a durable step only cost an Inngest execution.
  const data = parseShopCheckRequestedData(rawEventData);
  const { shopCheckId, url, commerceFlags } = data;

  // Best-effort "processing" marker — purely cosmetic for the poll, so a
  // failure here must not block the actual enrichment.
  await step.run("mark-processing", async () => {
    try {
      await writeDeepCheck(shopCheckId, { status: "processing" });
    } catch (err) {
      logger.warn("shop-signal-enrich: mark-processing failed", {
        shopCheckId,
        error: String(err),
      });
    }
  });

  // ABN — verifyShopAbnDeep fetches the homepage and, for an .au shop with
  // no homepage ABN, a small fixed set of candidate pages (/about, /terms,
  // …) under a shared budget. The ABN often lives off the homepage, so a
  // homepage-only check false-reports `no-abn` for legitimate AU shops
  // (GitHub #349). Fetch + extract/verify happen inside this ONE step, so
  // the (capped) HTML never crosses a step boundary as persisted state.
  const abn = await step.run("verify-abn", () => verifyShopAbnDeep(url));

  const domainAge = await step.run("domain-age", async () => {
    const domain = extractDomain(url);
    if (!domain) {
      return {
        band: domainAgeBand(null),
        ageDays: null,
        createdDate: null,
      };
    }
    const { createdDate } = await getDomainCreatedDate(domain);
    const ageDays = domainAgeDays(createdDate);
    return { band: domainAgeBand(ageDays), ageDays, createdDate };
  });

  const apivoid = await step.run("apivoid", async () => {
    if (!featureFlags.shopSignalPaidFeed) {
      return { attempted: false as const, result: null, skipReason: null };
    }
    const outcome = await getSiteTrustworthiness(url);
    if ("ok" in outcome) {
      // ApivoidSkip — the paid call was skipped or failed. skipReason
      // lets the log-cost step tell a by-design `brake` skip from a
      // genuine error.
      return {
        attempted: true as const,
        result: null,
        skipReason: outcome.reason,
      };
    }
    return { attempted: true as const, result: outcome, skipReason: null };
  });

  // Reviews — on-page review-authenticity signal. Flag-gated; when off, or on
  // any graceful skip (no supported app, endpoint unavailable), this returns a
  // null verdict that contributes 0 to the composite score. Fetches the page
  // HTML afresh (a second ~6s fetch on top of verify-abn's) rather than
  // threading it across a step boundary — simplest, and still far inside the
  // 3m budget. PR 4 adds the Claude language pass; for now `fakeLikelihood` is
  // null and the fusion is statistics-only.
  const reviews = await step.run("reviews", async () => {
    const none = { verdict: null, data: null, llmCostUsd: null } as {
      verdict: "clean" | "suspicious" | "manipulated" | null;
      data: ShopCheckReviews | null;
      llmCostUsd: number | null;
    };
    if (!featureFlags.shopSignalReviews) return none;
    const page = await fetchShopPage(url);
    if (!page.html) return none;
    const corpus = await detectAndFetchReviews(page.html);
    if ("ok" in corpus) return none;

    const { statBand, statReasons } = scoreReviewDistribution(
      corpus,
      domainAge.ageDays,
    );

    // Paid Claude language pass — flag- AND brake-gated. It corroborates the
    // statistics into a `manipulated` verdict (two-key fusion) and, crucially,
    // can refute a distribution-only false positive back down to `suspicious`.
    // Left null (statistics-only fusion) when the flag is off, the brake is
    // engaged, or the call fails — never a hard dependency.
    let fakeLikelihood: number | null = null;
    let llmReasons: string[] = [];
    let llmCostUsd: number | null = null;
    if (
      featureFlags.shopSignalReviewsLlm &&
      !(await isFeatureBraked("shop_signal_reviews"))
    ) {
      const llm = await assessReviewLanguage(corpus.reviews, shopCheckId);
      if (llm) {
        fakeLikelihood = llm.fakeLikelihood;
        llmReasons = llm.reasons;
        llmCostUsd = llm.costUsd;
      }
    }

    const verdict = fuseReviewsVerdict(statBand, fakeLikelihood);
    const data: ShopCheckReviews = {
      app: corpus.app,
      verdict,
      totalReviews: corpus.totalReviews,
      averageRating: corpus.averageRating,
      distribution: corpus.distribution,
      verifiedBuyerRatio: corpus.verifiedBuyerRatio,
      fakeLikelihood,
      reasons: [...statReasons, ...llmReasons],
      fetchedFrom: corpus.fetchedFrom,
    };
    return { verdict, data, llmCostUsd };
  });

  // Cost telemetry — best-effort. feature='shop_signal' so cost-daily-check
  // aggregates it into the SHOP_SIGNAL_CAP_USD brake. WHOIS + ABR are
  // free-tier — no cost rows for them.
  await step.run("log-cost", async () => {
    try {
      const supabase = createServiceClient();
      if (!supabase) return;
      if (apivoid.result) {
        await supabase.from("cost_telemetry").insert({
          feature: "shop_signal",
          provider: "apivoid",
          operation: "site-trust",
          units: apivoid.result.units,
          unit_cost_usd: 0,
          estimated_cost_usd: apivoid.result.estimatedCostUsd,
          request_id: shopCheckId,
          metadata: {
            source: "deep-check",
            verdict: apivoid.result.paidProviderVerdict.verdict,
            trust_score: apivoid.result.paidProviderVerdict.trustScore,
          },
        });
      } else if (apivoid.attempted && apivoid.skipReason !== "brake") {
        // APIVoid was attempted and genuinely failed (missing key, bad
        // host, HTTP error, timeout). $0 diagnostic row — cost-daily-check
        // and the health digest both watch this tag. A by-design `brake`
        // skip is deliberately excluded: it is the system working
        // correctly and must not look like an APIVoid error in the
        // digest (GitHub #349, F-B).
        await supabase.from("cost_telemetry").insert({
          feature: "shop-signal-apivoid-error",
          provider: "apivoid",
          operation: "site-trust",
          units: 0,
          unit_cost_usd: 0,
          estimated_cost_usd: 0,
          request_id: shopCheckId,
          metadata: { source: "deep-check", reason: apivoid.skipReason },
        });
      }
      // Reviews fetch is free-tier (public review-app endpoints); still log a
      // $0 row so volume/ceiling is visible in the cost dashboard. The paid
      // Claude pass (PR 4) will add its own cost to this same feature tag.
      if (reviews.data) {
        await supabase.from("cost_telemetry").insert({
          feature: "shop_signal_reviews",
          provider: reviews.data.app,
          operation: "reviews-fetch",
          units: 1,
          unit_cost_usd: 0,
          estimated_cost_usd: 0,
          request_id: shopCheckId,
          metadata: {
            source: "deep-check",
            app: reviews.data.app,
            verdict: reviews.data.verdict,
          },
        });
      }
      // Paid Claude language pass — real spend, same `shop_signal_reviews` tag
      // so cost-daily-check sums it into the REVIEWS_LLM_CAP_USD brake.
      if (reviews.llmCostUsd !== null) {
        await supabase.from("cost_telemetry").insert({
          feature: "shop_signal_reviews",
          provider: "anthropic",
          operation: "reviews-language",
          units: 1,
          unit_cost_usd: 0,
          estimated_cost_usd: reviews.llmCostUsd,
          request_id: shopCheckId,
          metadata: { source: "deep-check", app: reviews.data?.app ?? null },
        });
      }
    } catch (err) {
      logger.warn("shop-signal-enrich: log-cost failed", {
        shopCheckId,
        error: String(err),
      });
    }
  });

  const paidVerdict = apivoid.result?.paidProviderVerdict ?? null;
  const { score, band } = computeCompositeScore({
    domainAgeBand: domainAge.band,
    abnStatus: abn.status,
    apivoidVerdict: paidVerdict?.verdict ?? null,
    commerceFlagCount: commerceFlags.length,
    reviewsVerdict: reviews.verdict,
  });

  const enrichment: ShopCheckEnrichment = {
    status: "complete",
    domainAge,
    abn,
    ...(reviews.data && { reviews: reviews.data }),
    ...(paidVerdict && { paidProviderVerdict: paidVerdict }),
    compositeScore: score,
    band,
    evaluatedAt: new Date().toISOString(),
  };

  await step.run("write-back", async () => {
    const ok = await writeDeepCheck(
      shopCheckId,
      enrichment,
      score,
      bandToVerdict(band),
    );
    if (!ok) {
      // Row gone — retention swept it between request and enrichment.
      logger.warn("shop-signal-enrich: write-back found no row", {
        shopCheckId,
      });
    }
    // Durable reputation registry — best-effort, in-step (no extra Inngest
    // step). A concerning verdict is recorded even if the shop_checks row was
    // already swept, so the community warning outlives the individual check.
    if (reviews.data) {
      try {
        await registerReviewFinding(url, reviews.data, score);
      } catch (err) {
        logger.warn("shop-signal-enrich: registerReviewFinding threw", {
          shopCheckId,
          error: String(err),
        });
      }
    }
  });

  return { shopCheckId, score, band };
}

/**
 * The onFailure body, factored out of the Inngest config so it is
 * unit-testable without constructing the function (the same reasoning that
 * extracted runShopSignalEnrich). After the enrichment exhausts its
 * retries — e.g. a permanently failing write-back — this marks the row
 * terminally `error`. Without it a write-back-exhausted row sits at
 * `processing` forever and the client poll never resolves (GitHub #349,
 * MINOR-3).
 *
 * Best-effort: when the DB is itself the reason the retries were
 * exhausted, this handler's own write-back can fail too — that failure is
 * logged, not guaranteed away. It also emits a $0 `shop-signal-enrich-error`
 * cost_telemetry row so a spike in retry-exhausted deep checks surfaces in
 * the daily health digest (which Telegrams every `feature LIKE '%error%'`
 * row) instead of being visible only in the logs.
 *
 * `rawFailureEvent` is Inngest's `inngest/function.failed` event; it wraps
 * the original shop.check.requested.v1 at `.data.event`.
 */
export async function handleEnrichFailure(
  rawFailureEvent: unknown,
): Promise<void> {
  const original = (
    rawFailureEvent as { data?: { event?: { data?: unknown } } }
  )?.data?.event?.data;
  let shopCheckId: string;
  try {
    shopCheckId = parseShopCheckRequestedData(original).shopCheckId;
  } catch {
    logger.error(
      "shop-signal-enrich onFailure: could not parse the original event",
    );
    return;
  }
  try {
    await writeDeepCheck(shopCheckId, {
      status: "error",
      errorMessage: "Deep shop check failed — please try again later.",
    });
  } catch (err) {
    logger.error("shop-signal-enrich onFailure: error write-back failed", {
      shopCheckId,
      error: String(err),
    });
  }

  // Diagnostic $0 telemetry — a retry-exhausted deep check otherwise only
  // touches shop_checks.signal + the logs, so it is invisible to the daily
  // health digest. The `-error` suffix makes the digest's
  // `feature LIKE '%error%'` filter pick it up.
  try {
    const supabase = createServiceClient();
    if (supabase) {
      await supabase.from("cost_telemetry").insert({
        feature: "shop-signal-enrich-error",
        provider: "inngest",
        operation: "shop-signal-enrich",
        units: 0,
        unit_cost_usd: 0,
        estimated_cost_usd: 0,
        request_id: shopCheckId,
        metadata: { source: "deep-check", stage: "onFailure" },
      });
    }
  } catch (err) {
    logger.warn("shop-signal-enrich onFailure: telemetry insert failed", {
      shopCheckId,
      error: String(err),
    });
  }
}

export const shopSignalEnrich = inngest.createFunction(
  {
    id: "shop-signal-enrich",
    concurrency: { limit: 2 },
    timeouts: { finish: "3m" },
    name: "Shop Signal: Deep Shop Check enrichment",
    idempotency: "event.data.shopCheckId",
    retries: 2,
    // When all retries are exhausted, mark the row terminally `error` so
    // the client poll stops and the tray shows an honest failure state.
    onFailure: ({ event }) => handleEnrichFailure(event),
  },
  { event: SHOP_CHECK_REQUESTED_EVENT },
  // Inngest's `step` is structurally a superset of EnrichStep; the cast is
  // only needed because its step.run carries a tighter (Jsonify) result
  // type. runShopSignalEnrich only ever calls step.run.
  withAxiomLogging({ fnId: "shop-signal-enrich" }, ({ event, step }) =>
    runShopSignalEnrich(step as unknown as EnrichStep, event.data),
  ),
);
