import { inngest } from "./client";
import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";
import {
  ANALYZE_COMPLETED_EVENT,
  parseAnalyzeCompletedData,
} from "./events";

// Claude Haiku 4.5 token pricing (April 2026 list prices, $ per token).
// Duplicated from apps/web/lib/cost-telemetry.ts `PRICING` to avoid a
// cross-package dependency from scam-engine → apps/web. When pricing
// changes, update both places (there's no shared pricing package yet —
// if a third location appears, extract one).
const CLAUDE_HAIKU_4_5_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const CLAUDE_HAIKU_4_5_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

function claudeHaikuCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    inputTokens * CLAUDE_HAIKU_4_5_INPUT_USD_PER_TOKEN +
    outputTokens * CLAUDE_HAIKU_4_5_OUTPUT_USD_PER_TOKEN
  );
}

// Durable consumer for analyze.completed.v1 — persists Claude cost
// telemetry to cost_telemetry. Replaces the inline `logCost` call in
// analyze/route.ts that was wrapped in waitUntil (and therefore lost on
// function-kill events).
//
// Idempotency: cost_telemetry has no unique constraint on requestId
// today. Double-writes on retry would inflate daily totals. Rely on
// Inngest's function-level `idempotency: "event.data.requestId"` to
// prevent duplicate executions.
//
// Not covered: Twilio Lookup cost, which fires inline in the route (Phase
// 2 scope keeps Twilio synchronous for UX — phoneIntelligence needs to
// land in the initial response).

export const handleAnalyzeCompletedCost = inngest.createFunction(
  {
    id: "analyze-completed-cost",
    name: "Analyze: Record Claude cost telemetry",
    idempotency: "event.data.requestId",
    retries: 2,
  },
  { event: ANALYZE_COMPLETED_EVENT },
  async ({ event, step }) => {
    const data = await step.run("parse-event", () =>
      parseAnalyzeCompletedData(event.data)
    );

    if (!data.usage) {
      return { skipped: true, reason: "no usage (cache hit or mock)" };
    }
    if (data.cacheHit) {
      return { skipped: true, reason: "cache hit — no Claude call" };
    }

    await step.run("insert-cost-telemetry", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("analyze.cost.supabase_unavailable", {
          requestId: data.requestId,
        });
        return;
      }

      const totalTokens = data.usage!.inputTokens + data.usage!.outputTokens;
      const costUsd = claudeHaikuCostUsd(
        data.usage!.inputTokens,
        data.usage!.outputTokens
      );

      const feature =
        data.source === "web"
          ? "web_analyze"
          : data.source === "extension"
            ? "extension_analyze"
            : `${data.source}_analyze`;

      const { error } = await supabase.from("cost_telemetry").insert({
        feature,
        provider: "anthropic",
        operation: "claude-haiku-4-5-20251001",
        units: totalTokens,
        unit_cost_usd: 0, // total_cost is the authoritative number
        estimated_cost_usd: costUsd,
        request_id: data.requestId,
        metadata: {
          input_tokens: data.usage!.inputTokens,
          output_tokens: data.usage!.outputTokens,
          cache_read: data.usage!.cacheReadInputTokens ?? 0,
          has_images: data.imageCount > 0,
          image_count: data.imageCount,
          mode: data.inputMode ?? "text",
        },
      });

      if (error) {
        // Throw so Inngest retries per the `retries: 2` policy.
        throw new Error(`cost_telemetry insert failed: ${error.message}`);
      }
    });

    logger.info("analyze.cost.recorded", {
      requestId: data.requestId,
      tokens: data.usage.inputTokens + data.usage.outputTokens,
      source: data.source,
    });

    return { recorded: true };
  }
);
