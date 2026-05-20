// shop-signal-enrich — Deep Shop Check enrichment Inngest function.
//
// Consumes shop.check.requested.v1 (emitted by POST /api/shop-check on a
// user click). Runs the three Stage-1 signals — ABN verification, WHOIS
// domain age, APIVoid Site Trustworthiness — computes a transparent
// composite score, and writes the result back onto the shop_checks row the
// client is polling via GET /api/shop-check/[id].
//
// Expected duration: ~5–35s (page fetch ~6s + WHOIS 5s + ABR 10s + APIVoid
// 10s, mostly sequential). Well under the 5-min Inngest budget and the
// 10-min pg-stuck-query-watchdog horizon — the only DB work is three small
// RPC calls.
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
import { fetchShopPage } from "../fetch-shop-page";
import { verifyShopAbn } from "../abn-extract";
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
  const data = await step.run("parse-event", () =>
    parseShopCheckRequestedData(rawEventData),
  );
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

  // ABN — fetch the page and extract/verify in ONE step so the (capped)
  // HTML never crosses a step boundary as persisted state.
  const abn = await step.run("verify-abn", async () => {
    const page = await fetchShopPage(url);
    return verifyShopAbn(page.html ?? "", page.finalUrl ?? url);
  });

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
      return { attempted: false, result: null };
    }
    const result = await getSiteTrustworthiness(url);
    return { attempted: true, result };
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
      } else if (apivoid.attempted) {
        // APIVoid was called but returned null (key missing, brake
        // engaged, HTTP error). $0 diagnostic row — cost-daily-check
        // and the health digest both watch this tag.
        await supabase.from("cost_telemetry").insert({
          feature: "shop-signal-apivoid-error",
          provider: "apivoid",
          operation: "site-trust",
          units: 0,
          unit_cost_usd: 0,
          estimated_cost_usd: 0,
          request_id: shopCheckId,
          metadata: { source: "deep-check" },
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

export const shopSignalEnrich = inngest.createFunction(
  {
    id: "shop-signal-enrich",
    name: "Shop Signal: Deep Shop Check enrichment",
    idempotency: "event.data.shopCheckId",
    retries: 2,
  },
  { event: SHOP_CHECK_REQUESTED_EVENT },
  // Inngest's `step` is structurally a superset of EnrichStep; the cast is
  // only needed because its step.run carries a tighter (Jsonify) result
  // type. runShopSignalEnrich only ever calls step.run.
  ({ event, step }) =>
    runShopSignalEnrich(step as unknown as EnrichStep, event.data),
);
