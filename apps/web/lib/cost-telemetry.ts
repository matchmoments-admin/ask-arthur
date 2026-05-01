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

  // Claude Sonnet 4.6: $3/M input, $15/M output (April 2026 list price).
  // Cache writes billed at 1.25x input, cache reads at 0.1x input.
  CLAUDE_SONNET_4_6_INPUT_USD_PER_TOKEN: 3 / 1_000_000,
  CLAUDE_SONNET_4_6_OUTPUT_USD_PER_TOKEN: 15 / 1_000_000,
  CLAUDE_SONNET_4_6_CACHE_WRITE_USD_PER_TOKEN: 3.75 / 1_000_000,
  CLAUDE_SONNET_4_6_CACHE_READ_USD_PER_TOKEN: 0.3 / 1_000_000,

  // Voyage 3 embeddings: ~$0.06/M tokens (1024-dim, AU/global, Jan 2026 list).
  // Default embedding provider; OpenAI text-embedding-3-small is the swap-in.
  VOYAGE_3_USD_PER_TOKEN: 0.06 / 1_000_000,

  // OpenAI text-embedding-3-small: $0.02/M tokens (1536-dim, May 2024 list,
  // unchanged through Apr 2026). Fallback embedding provider.
  OPENAI_TEXT_EMBED_3_SMALL_USD_PER_TOKEN: 0.02 / 1_000_000,

  // Twilio Lookup v2: ~$0.018 per lookup (line-type + carrier + CNAM).
  TWILIO_LOOKUP_V2_USD: 0.018,

  // Resemble AI deepfake-audio detection: ~$2.40 per 1000 minutes = $0.086/min.
  RESEMBLE_AI_USD_PER_SECOND: 0.086 / 60,

  // OpenAI Whisper: $0.006 per minute.
  OPENAI_WHISPER_USD_PER_SECOND: 0.006 / 60,

  // Resend: Pro plan is $20/50k = $0.0004 per outbound email. Cheap per-unit
  // but we send batched digests so the monthly aggregate matters for the
  // cost dashboard — without instrumentation these sends were invisible.
  RESEND_USD_PER_EMAIL: 20 / 50_000,

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
