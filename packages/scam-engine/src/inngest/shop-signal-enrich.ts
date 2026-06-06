// shop-signal-enrich — Deep Shop Check enrichment Inngest function.
//
// Consumes shop.check.requested.v1 (emitted by POST /api/shop-check on a
// user click). Runs the three Stage-1 signals — ABN verification, WHOIS
// domain age, APIVoid Site Trustworthiness — computes a transparent
// composite score, and writes the result back onto the shop_checks row the
// client is polling via GET /api/shop-check/[id].
//
// Expected duration: ~5–50s (page fetch ~6s — up to ~16s when the ABN is
// not on the homepage and verifyShopAbnDeep walks /about-/terms-style
// candidate pages — + WHOIS 5s + ABR 10s + APIVoid 10s, mostly
// sequential). Well under the 5-min Inngest budget and the 10-min
// pg-stuck-query-watchdog horizon — the only DB work is three small RPC
// calls.
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
  });

  const enrichment: ShopCheckEnrichment = {
    status: "complete",
    domainAge,
    abn,
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
