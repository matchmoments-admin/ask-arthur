// Shared in-package cost-telemetry sink for @askarthur/scam-engine.
//
// WHY this exists: scam-engine CANNOT import apps/web's `logCost`/`PRICING`
// (that's the wrong dependency direction — web depends on engine), and there
// is no `@askarthur/utils/cost-telemetry` export despite an older doc claim.
// Before this module, the in-package pattern was a per-file local `logCost`
// (feed-items-embed.ts, scam-report-embed.ts, hibp.ts inline) — five paid-API
// helpers (Twilio, AbuseIPDB, IPQS, URLScan, crt.sh) logged NOTHING, so their
// spend + free-tier consumption was invisible to /admin/costs and the weekly
// Telegram digest. This concentrates the duplicated insert in one place.
//
// Free-tier note: for APIs that bill $0 on their free tier today (AbuseIPDB
// 1k/day, URLScan 100/day public, crt.sh unmetered) we still log `units` with
// `estimatedCostUsd: 0`, so the dashboard shows call VOLUME and we can see a
// free-tier ceiling approaching before it starts charging — same convention
// as the Hive placeholder (BACKLOG #480) and clone-watch's $0 telemetry rows.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

/** Per-call USD unit costs for scam-engine paid APIs. $0 = free tier today.
 *
 *  Claude token costs are deliberately NOT here: per-token Claude pricing lives
 *  in `anthropic.ts::MODELS` (priced per model tier), and Claude spend is logged
 *  at the call site that knows the token usage (e.g. apps/web /api/analyze, the
 *  reddit-intel functions) — not via this flat per-call table. If you add a new
 *  Claude call path, compute cost from `anthropic.ts::MODELS` and pass it to
 *  `logCost({ provider: "anthropic", estimatedCostUsd })`. */
export const ENGINE_PRICING = {
  // Twilio Lookup v2: line-type intelligence ($0.008) + CNAM ($0.01).
  TWILIO_LOOKUP_V2_USD: 0.018,
  // IPQS phone fraud — paid per lookup on our plan.
  IPQS_PHONE_FRAUD_USD: 0.003,
  // AbuseIPDB: free tier 1,000 checks/day. Track units to watch the ceiling.
  ABUSEIPDB_CHECK_USD: 0,
  // URLScan.io: free tier 100 scans/day (public). Paid tier is metered
  // separately by the urlscan-enrichment function's own telemetry.
  URLSCAN_SUBMIT_USD: 0,
  // crt.sh Certificate Transparency search — unmetered / free.
  CT_LOOKUP_USD: 0,
} as const;

export interface CostLogArgs {
  /** Stable feature tag, e.g. "twilio-lookup". Groups in /admin/costs. */
  feature: string;
  /** Provider name, e.g. "twilio", "abuseipdb", "urlscan", "crtsh". */
  provider: string;
  /** Operation label, e.g. "lookups.v2.fetch". */
  operation: string;
  /** Billable units (lookups, scans, tokens). Defaults to 1. */
  units?: number;
  /** Estimated USD for this call. Use 0 for free-tier APIs (still logs units). */
  estimatedCostUsd: number;
  /** Optional structured context (never PII — hash/last-4 only). */
  metadata?: Record<string, unknown>;
}

/**
 * Insert one cost_telemetry row. Best-effort and never throws: a telemetry
 * failure must not break the paid call it is measuring. Mirrors the
 * logFunctionError "swallow on failure" contract.
 *
 * Call this ONLY on a real billable call (i.e. after a cache MISS that hit
 * the upstream API), so cached responses don't inflate the spend/volume view.
 */
export async function logCost(args: CostLogArgs): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;
  try {
    await supabase.from("cost_telemetry").insert({
      feature: args.feature,
      provider: args.provider,
      operation: args.operation,
      units: args.units ?? 1,
      estimated_cost_usd: args.estimatedCostUsd,
      metadata: args.metadata ?? {},
    });
  } catch (err) {
    logger.warn("logCost insert failed", {
      feature: args.feature,
      error: String(err),
    });
  }
}

/**
 * Record a permanent function failure as a `cost_telemetry` error row so the
 * daily health-digest (which aggregates `feature LIKE '%error%'` into an admin
 * Telegram) surfaces it — the in-package "page on failure" path for
 * scam-engine functions that can't import apps/web's Telegram helper. Use from
 * an Inngest `onFailure` handler (fires once after retries are exhausted).
 * Best-effort: never throws.
 */
export async function logFunctionFailure(
  feature: string,
  operation: string,
  error: unknown,
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;
  try {
    await supabase.from("cost_telemetry").insert({
      feature,
      provider: "diagnostic",
      operation,
      units: 0,
      estimated_cost_usd: 0,
      metadata: {
        error_message: error instanceof Error ? error.message : String(error),
        error_name: error instanceof Error ? error.name : "Unknown",
      },
    });
  } catch {
    // Diagnostic insert failed — swallow.
  }
}

/**
 * Read-side cost-brake check for any feature. Generic version of
 * isRedditIntelBraked — returns true when feature_brakes has a row for
 * `feature` with paused_until in the future. Best-effort: any DB error
 * returns false (don't block the pipeline if the brake check itself fails).
 *
 * cost-daily-check sets these rows when a feature's daily spend exceeds its
 * configured cap (see apps/web/app/api/cron/cost-daily-check/route.ts).
 */
export async function isFeatureBraked(feature: string): Promise<boolean> {
  const supabase = createServiceClient();
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .from("feature_brakes")
      .select("paused_until")
      .eq("feature", feature)
      .maybeSingle();
    if (!data) return false;
    const pausedUntil = data.paused_until
      ? new Date(data.paused_until as string)
      : null;
    return !!(pausedUntil && pausedUntil.getTime() > Date.now());
  } catch {
    return false;
  }
}
