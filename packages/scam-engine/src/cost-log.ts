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
// 1k/day, URLScan 1k/day unlisted (measured 2026-08-23), crt.sh unmetered) we still log `units` with
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
  // URLScan.io: measured 2026-08-23 — unlisted 1,000/day (our lane), public
  // 5,000/day. The "100/day" figure this repo carried was never verified.
  // Paid tier is metered
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
    // supabase-js RETURNS a PostgREST error rather than throwing, so the catch
    // below only ever saw network throws: a rejected insert (constraint, RLS,
    // timeout) vanished silently. That row is often a Lane's Outcome Row, so a
    // lost write read as the Lane being "absent" with nothing to explain why
    // (review 2026-09-24).
    const { error } = await supabase.from("cost_telemetry").insert({
      feature: args.feature,
      provider: args.provider,
      operation: args.operation,
      units: args.units ?? 1,
      estimated_cost_usd: args.estimatedCostUsd,
      metadata: args.metadata ?? {},
    });
    if (error) {
      logger.warn("logCost insert rejected", {
        feature: args.feature,
        operation: args.operation,
        error: error.message,
      });
    }
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

/** A feature brake read has THREE outcomes, not two — the third is the one
 *  every hand-rolled check collapsed differently. */
export type BrakeState = "engaged" | "clear" | "unknown";

/**
 * The ONE read of `feature_brakes`. `unknown` = the read itself failed (no
 * client, PostgREST error, throw). Callers choose the policy for `unknown`
 * through the two wrappers below — never by re-implementing the read.
 * (Before 2026-09-23 there were five copies: isFeatureBraked treated a
 * PostgREST error — returned, not thrown — as `clear`, while three inline
 * copies treated it as `engaged`, so outbound Lanes proceeded on a DB error
 * while notify Lanes stopped.)
 *
 * cost-daily-check sets these rows when a feature's daily spend exceeds its
 * configured cap (see apps/web/app/api/cron/cost-daily-check/route.ts).
 */
export async function brakeState(feature: string): Promise<BrakeState> {
  const supabase = createServiceClient();
  if (!supabase) return "unknown";
  try {
    const { data, error } = await supabase
      .from("feature_brakes")
      .select("paused_until")
      .eq("feature", feature)
      .maybeSingle();
    if (error) {
      logger.warn("brakeState: lookup failed", { feature, error: error.message });
      return "unknown";
    }
    const pausedUntil = data?.paused_until
      ? new Date(data.paused_until as string).getTime()
      : null;
    return pausedUntil && pausedUntil > Date.now() ? "engaged" : "clear";
  } catch (err) {
    logger.warn("brakeState: lookup threw", { feature, error: String(err) });
    return "unknown";
  }
}

/** Fail-OPEN: only a confirmed engaged brake stops the caller. For pipelines
 *  where a skipped run costs more than a possibly-braked one. */
export async function isFeatureBraked(feature: string): Promise<boolean> {
  return (await brakeState(feature)) === "engaged";
}

/** Fail-CLOSED: an unreadable brake counts as engaged. For Lanes that spend
 *  money or send outbound (vendor reports, emails, paid APIs). */
export async function isFeatureBrakedOrUnknown(feature: string): Promise<boolean> {
  return (await brakeState(feature)) !== "clear";
}
