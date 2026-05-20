import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { getSiteTrustworthiness } from "../providers/apivoid";
import { inngest } from "./client";
import {
  SHOP_SIGNAL_EVALUATED_EVENT,
  parseShopSignalEvaluatedData,
} from "./events";

interface CostTelemetryInput {
  feature: "shop_signal" | "shop-signal-apivoid-error";
  operation: "site-trustworthiness" | "site-trustworthiness-error";
  units: number;
  estimatedCostUsd: number;
  requestId: string;
  metadata: Record<string, unknown>;
}

async function insertCostTelemetry(input: CostTelemetryInput): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("shop_signal.cost.supabase_unavailable", {
      requestId: input.requestId,
      feature: input.feature,
    });
    return;
  }

  const { error } = await supabase.from("cost_telemetry").insert({
    feature: input.feature,
    provider: "apivoid",
    operation: input.operation,
    units: input.units,
    unit_cost_usd: 0,
    estimated_cost_usd: input.estimatedCostUsd,
    request_id: input.requestId,
    metadata: input.metadata,
  });

  if (error) {
    throw new Error(`cost_telemetry insert failed: ${error.message}`);
  }
}

async function updateShopCheckSignal(
  shopCheckId: string,
  paidProviderVerdict: unknown,
): Promise<boolean> {
  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("shop_signal.update.supabase_unavailable", { shopCheckId });
    return false;
  }

  const { data, error } = await supabase.rpc("update_shop_check_signal", {
    p_id: shopCheckId,
    p_patch: { paidProviderVerdict },
  });

  if (error) {
    throw new Error(`update_shop_check_signal failed: ${error.message}`);
  }

  return data === true;
}

// APIVoid can take several seconds to complete a live host scan. This runs
// post-response in Inngest, outside /api/analyze latency.
export const shopSignalPaidProvider = inngest.createFunction(
  {
    id: "shop-signal-paid-provider",
    name: "Shop Signal: APIVoid paid provider",
    idempotency: "event.data.shopCheckId",
    retries: 2,
  },
  { event: SHOP_SIGNAL_EVALUATED_EVENT },
  async ({ event, step }) => {
    const data = await step.run("parse-event", () =>
      parseShopSignalEvaluatedData(event.data),
    );

    if (!featureFlags.shopSignalPaidFeed) {
      return { skipped: true, reason: "FF_SHOP_SIGNAL_PAID_FEED off" };
    }

    const result = await step.run("apivoid-site-trustworthiness", () =>
      getSiteTrustworthiness(data.host),
    );

    if (!result) {
      await step.run("insert-apivoid-error-cost-telemetry", () =>
        insertCostTelemetry({
          feature: "shop-signal-apivoid-error",
          operation: "site-trustworthiness-error",
          units: 0,
          estimatedCostUsd: 0,
          requestId: data.requestId,
          metadata: {
            shop_check_id: data.shopCheckId,
            host: data.host,
            urls: data.urls,
            reason: "adapter-returned-null",
          },
        }),
      );
      return { skipped: true, reason: "apivoid-null" };
    }

    const updated = await step.run("update-shop-check-signal", () =>
      updateShopCheckSignal(data.shopCheckId, result.paidProviderVerdict),
    );

    await step.run("insert-apivoid-cost-telemetry", () =>
      insertCostTelemetry({
        feature: "shop_signal",
        operation: "site-trustworthiness",
        units: result.units,
        estimatedCostUsd: result.estimatedCostUsd,
        requestId: data.requestId,
        metadata: {
          shop_check_id: data.shopCheckId,
          host: data.host,
          urls: data.urls,
          verdict: result.paidProviderVerdict.verdict,
          trust_score: result.paidProviderVerdict.trustScore,
          updated,
        },
      }),
    );

    logger.info("shop_signal.apivoid.recorded", {
      requestId: data.requestId,
      shopCheckId: data.shopCheckId,
      host: data.host,
      verdict: result.paidProviderVerdict.verdict,
      updated,
    });

    return { updated, verdict: result.paidProviderVerdict.verdict };
  },
);
