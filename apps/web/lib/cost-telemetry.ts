import { waitUntil } from "@vercel/functions";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export interface CostEvent {
  feature: string;
  provider: string;
  operation: string;
  units?: number;
  unitCostUsd?: number;
  estimatedCostUsd?: number;
  metadata?: Record<string, unknown>;
  userId?: string | null;
  requestId?: string | null;
}

// Pricing constants — single source of truth for per-unit costs.
// Update here whenever upstream pricing changes.
export const PRICING = {
  // Claude Haiku 4.5: $1/M input, $5/M output (April 2026 list price).
  CLAUDE_HAIKU_4_5_INPUT_USD_PER_TOKEN: 1 / 1_000_000,
  CLAUDE_HAIKU_4_5_OUTPUT_USD_PER_TOKEN: 5 / 1_000_000,

  // Twilio Lookup v2: ~$0.018 per lookup (line-type + carrier + CNAM).
  TWILIO_LOOKUP_V2_USD: 0.018,

  // Resemble AI deepfake-audio detection: ~$2.40 per 1000 minutes = $0.086/min.
  RESEMBLE_AI_USD_PER_SECOND: 0.086 / 60,

  // OpenAI Whisper: $0.006 per minute.
  OPENAI_WHISPER_USD_PER_SECOND: 0.006 / 60,

  // Google Safe Browsing is free up to very high limits.
  // Reality Defender free tier = 50/month, paid rates not public — log units
  // without a unit_cost when we actually start calling it.
  // Hive AI pricing is undocumented internally — require explicit per-call cost.
} as const;

/**
 * Fire-and-forget cost telemetry insert.
 *
 * Wrapped in `waitUntil` so the Supabase write survives the response being
 * returned (Vercel may otherwise kill pending promises). No-ops if Supabase
 * is unreachable or misconfigured — never blocks or throws to the caller.
 */
export function logCost(ev: CostEvent): void {
  const units = ev.units ?? 1;
  const unitCost = ev.unitCostUsd ?? 0;
  const total = ev.estimatedCostUsd ?? units * unitCost;

  const supabase = createServiceClient();
  if (!supabase) return;

  const p: Promise<void> = (async () => {
    const { error } = await supabase.from("cost_telemetry").insert({
      feature: ev.feature,
      provider: ev.provider,
      operation: ev.operation,
      units,
      unit_cost_usd: unitCost,
      estimated_cost_usd: total,
      metadata: ev.metadata ?? {},
      user_id: ev.userId ?? null,
      request_id: ev.requestId ?? null,
    });
    if (error) {
      logger.warn("logCost insert failed", { error: String(error) });
    }
  })();

  try {
    waitUntil(p);
  } catch {
    void p;
  }
}

/**
 * Compute the Claude Haiku 4.5 cost for a given usage.
 * Does not account for cache reads (billed at 10% of input rate) yet —
 * that's a nice-to-have refinement, not launch-critical.
 */
export function claudeHaikuCostUsd(
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    inputTokens * PRICING.CLAUDE_HAIKU_4_5_INPUT_USD_PER_TOKEN +
    outputTokens * PRICING.CLAUDE_HAIKU_4_5_OUTPUT_USD_PER_TOKEN
  );
}
