// Shop Signal Stage 1 paid-provider fan-out.
//
// Expected duration: <15s. APIVoid gets a 10s timeout in the adapter; the
// remaining time is a single shop_checks JSONB patch plus one cost row.
// The function is post-response only and idempotent on shopCheckId.

import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { getSiteTrustworthiness } from "../providers/apivoid";
import { inngest } from "./client";
import {
  SHOP_SIGNAL_EVALUATED_EVENT,
  parseShopSignalEvaluatedData,
} from "./events";

export const shopSignalPaidProvider = inngest.createFunction(
  {
    id: "shop-signal-paid-provider",
    name: "Shop Signal: Paid provider enrichment",
    idempotency: "event.data.shopCheckId",
    retries: 2,
  },
  { event: SHOP_SIGNAL_EVALUATED_EVENT },
  async ({ event, step }) => {
    const data = await step.run("parse-event", () =>
      parseShopSignalEvaluatedData(event.data)
    );

    if (!featureFlags.shopSignalPaidFeed) {
      return { skipped: true, reason: "FF_SHOP_SIGNAL_PAID_FEED off" };
    }

    const trust = await step.run("apivoid-site-trust", () =>
      getSiteTrustworthiness(data.host)
    );
    if (!trust) {
      return { skipped: true, reason: "apivoid_unavailable_or_braked" };
    }

    await step.run("patch-shop-check-and-record-cost", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        throw new Error("supabase unavailable");
      }

      const { data: patched, error: patchError } = await supabase.rpc("update_shop_check_signal", {
        p_id: data.shopCheckId,
        p_patch: { paidProviderVerdict: trust.paidProviderVerdict },
      });
      if (patchError) {
        throw new Error(`update_shop_check_signal failed: ${patchError.message}`);
      }
      if (!patched) {
        throw new Error(`shop_check not found: ${data.shopCheckId}`);
      }

      const { error: costError } = await supabase.from("cost_telemetry").insert({
        feature: "shop_signal",
        provider: "apivoid",
        operation: "site-trustworthiness",
        units: trust.units,
        unit_cost_usd: 0,
        estimated_cost_usd: trust.estimatedCostUsd,
        request_id: data.requestId,
        metadata: {
          host: data.host,
          shop_check_id: data.shopCheckId,
          verdict: trust.paidProviderVerdict.verdict,
          trust_score: trust.paidProviderVerdict.trustScore,
          blacklist_detections: trust.paidProviderVerdict.blacklistDetections,
        },
      });
      if (costError) {
        throw new Error(`shop_signal cost_telemetry insert failed: ${costError.message}`);
      }
    });

    logger.info("shop-signal.paid-provider.recorded", {
      requestId: data.requestId,
      shopCheckId: data.shopCheckId,
      host: data.host,
      verdict: trust.paidProviderVerdict.verdict,
    });

    return { recorded: true };
  },
);
