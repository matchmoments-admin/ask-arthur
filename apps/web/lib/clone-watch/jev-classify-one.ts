// Shared I/O for classifying ONE clone-watch candidate with TypeSafe Jev.
// Two modes, one vendor call each, one place for the write path:
//
//   classifyPrimaryWithJev — ADR-0026, since 2026-09-22. Jev IS the
//     pre-classifier: writes the v157 `clone_watch_classifications` row
//     (the sibling every worklist gate reads) in Haiku's shape via
//     `toClassificationRow`, plus the raw-probability v311 row, plus ONE
//     cost row under the pre-classifier's own feature tag. NOT fail-soft:
//     a vendor/persist failure logs the `_error` row and THROWS so Inngest
//     retries and the daily selector re-fans tomorrow — the same recovery
//     semantics the Haiku path has always had.
//
//   classifyOneWithJev — the shadow lane (rollback mode after the swap, and
//     the backfill/repair script). Writes only the v311 row and is fail-soft
//     by design: the live caller runs it after Haiku's row is persisted and
//     must not fail that result. Acceptable only because every failure is
//     observable as a $0 `_jev_error` row keyed on `reason`.
//
// Side-effecting, so it lives here rather than in the pure jev-preclassify
// rubric module. Same division of labour as urlscan-submit-one.ts.

import { askJev } from "@askarthur/scam-engine/providers/jev";
import type { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { PRICING, logCostAsync } from "@/lib/cost-telemetry";
import {
  JEV_PROMPT_VERSION,
  JevAnswerShapeError,
  buildJevPreclassifyQuestions,
  buildJevState,
  mapJevAnswersToRow,
  toClassificationRow,
  toClassificationRpcArgs,
  toJevRpcArgs,
  type JevPreclassifyInput,
} from "@/lib/clone-watch/jev-preclassify";

/** Shadow-mode telemetry tags (rollback + repair). */
export const JEV_COST_FEATURE = "shopfront_clone_preclassify_jev";
export const JEV_ERROR_FEATURE = "shopfront_clone_preclassify_jev_error";
/** Primary-mode tags — the pre-classifier's own feature, so the absence
 *  watch, the outreach cap and /admin/costs keep working; `provider` is
 *  what changed from `anthropic` to `typesafe`. */
export const PRECLASSIFY_COST_FEATURE = "shopfront_clone_preclassify";
export const PRECLASSIFY_ERROR_FEATURE = "shopfront_clone_preclassify_error";

const BRAKE = "shopfront_clone_outreach";

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

/**
 * Shared brake read. Conservative: an unreadable brake counts as engaged
 * (a paid vendor call is the thing being protected). Used by both modes'
 * callers before spending.
 */
export async function isPreclassifyBraked(sb: Sb): Promise<boolean> {
  const { data, error } = await sb
    .from("feature_brakes")
    .select("paused_until")
    .eq("feature", BRAKE)
    .maybeSingle();
  if (error) {
    logger.warn("clone-watch preclassify: brake lookup failed", {
      error: error.message,
    });
    return true;
  }
  return Boolean(
    data?.paused_until && new Date(data.paused_until).getTime() > Date.now(),
  );
}

export class JevPrimaryError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(`jev-primary: ${message}`);
    this.name = "JevPrimaryError";
  }
}

export interface ClassifyPrimaryWithJevArgs {
  sb: Sb;
  alertId: number;
  input: JevPreclassifyInput;
  requestId: string;
}

export interface JevPrimaryResult {
  is_clone: boolean;
  confidence: number;
  clone_tactic: string;
  attack_intent: string;
  model_id: string;
  input_tokens: number;
  latency_ms: number;
}

/**
 * Primary mode (ADR-0026). Throws `JevPrimaryError` after logging the $0
 * `shopfront_clone_preclassify_error` row on any vendor / shape / persist
 * failure. The caller has already checked the brake.
 */
export async function classifyPrimaryWithJev(
  args: ClassifyPrimaryWithJevArgs,
): Promise<JevPrimaryResult> {
  const { sb, alertId, input, requestId } = args;

  const fail = async (
    reason: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): Promise<never> => {
    await logCostAsync({
      feature: PRECLASSIFY_ERROR_FEATURE,
      provider: "typesafe",
      operation: "classify_error",
      units: 0,
      unitCostUsd: 0,
      requestId,
      metadata: {
        alert_id: alertId,
        brand: input.brand,
        reason,
        error_message: message.slice(0, 500),
        prompt_version: JEV_PROMPT_VERSION,
        ...extra,
      },
    });
    throw new JevPrimaryError(reason, message);
  };

  const res = await askJev(
    buildJevState(input),
    buildJevPreclassifyQuestions(),
    { requestId },
  );
  if (!res.ok) {
    return fail(res.reason, `vendor ${res.reason}`, {
      status: res.status ?? null,
    });
  }

  let row;
  try {
    row = mapJevAnswersToRow(res.answers);
  } catch (err) {
    if (err instanceof JevAnswerShapeError) {
      return fail("bad_answers", err.message);
    }
    throw err;
  }
  const classification = toClassificationRow(row);

  // The gated sibling first — it is the row that matters; the raw
  // probabilities are a bonus for later threshold tuning.
  const primary = await sb.rpc(
    "record_clone_watch_classification",
    toClassificationRpcArgs({
      alertId,
      brand: input.brand,
      candidateDomain: input.candidateDomain,
      classification,
      modelId: res.model,
      inputTokens: res.usage.inputTokens,
    }),
  );
  if (primary.error) {
    return fail("persist_failed", primary.error.message);
  }
  const raw = await sb.rpc(
    "record_clone_watch_jev_classification",
    toJevRpcArgs({
      alertId,
      brand: input.brand,
      candidateDomain: input.candidateDomain,
      row,
      modelId: res.model,
      source: "live",
      inputTokens: res.usage.inputTokens,
      latencyMs: res.elapsedMs,
    }),
  );
  if (raw.error) {
    // The gate row is written; losing the raw row is a warn, not a retry.
    logger.warn("jev-primary: raw-probability row failed", {
      alertId,
      error: raw.error.message,
    });
  }

  await logCostAsync({
    feature: PRECLASSIFY_COST_FEATURE,
    provider: "typesafe",
    operation: "classify",
    units: res.usage.inputTokens,
    unitCostUsd: PRICING.JEV_USD_PER_INPUT_TOKEN,
    requestId,
    metadata: {
      alert_id: alertId,
      brand: input.brand,
      is_clone: classification.is_clone,
      confidence: classification.confidence,
      is_clone_p: row.is_clone_p,
      clone_tactic: classification.clone_tactic,
      attack_intent: classification.attack_intent,
      model_id: res.model,
      prompt_version: JEV_PROMPT_VERSION,
      latency_ms: res.elapsedMs,
    },
  });

  return {
    is_clone: classification.is_clone,
    confidence: classification.confidence,
    clone_tactic: classification.clone_tactic,
    attack_intent: classification.attack_intent,
    model_id: res.model,
    input_tokens: res.usage.inputTokens,
    latency_ms: res.elapsedMs,
  };
}

export type JevShadowOutcome =
  | { kind: "ok"; isCloneP: number; inputTokens: number; latencyMs: number }
  | { kind: "error"; reason: string };

export interface ClassifyOneWithJevArgs {
  sb: Sb;
  alertId: number;
  input: JevPreclassifyInput;
  source: "live" | "backfill";
  requestId: string;
}

export async function classifyOneWithJev(
  args: ClassifyOneWithJevArgs,
): Promise<JevShadowOutcome> {
  const { sb, alertId, input, source, requestId } = args;

  const fail = async (
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<JevShadowOutcome> => {
    await logCostAsync({
      feature: JEV_ERROR_FEATURE,
      provider: "typesafe",
      operation: "classify_error",
      units: 0,
      unitCostUsd: 0,
      requestId,
      metadata: {
        alert_id: alertId,
        brand: input.brand,
        source,
        reason,
        prompt_version: JEV_PROMPT_VERSION,
        ...extra,
      },
    });
    return { kind: "error", reason };
  };

  const res = await askJev(
    buildJevState(input),
    buildJevPreclassifyQuestions(),
    { requestId },
  );
  if (!res.ok) return fail(res.reason, { status: res.status ?? null });

  let row;
  try {
    row = mapJevAnswersToRow(res.answers);
  } catch (err) {
    if (err instanceof JevAnswerShapeError) {
      return fail("bad_answers", { error_message: err.message.slice(0, 500) });
    }
    throw err;
  }

  const { error: rpcError } = await sb.rpc(
    "record_clone_watch_jev_classification",
    toJevRpcArgs({
      alertId,
      brand: input.brand,
      candidateDomain: input.candidateDomain,
      row,
      modelId: res.model,
      source,
      inputTokens: res.usage.inputTokens,
      latencyMs: res.elapsedMs,
    }),
  );
  if (rpcError) {
    logger.warn("jev-shadow: persist failed", {
      alertId,
      error: rpcError.message,
    });
    return fail("persist_failed", {
      error_message: rpcError.message.slice(0, 500),
    });
  }

  await logCostAsync({
    feature: JEV_COST_FEATURE,
    provider: "typesafe",
    operation: "classify",
    units: res.usage.inputTokens,
    unitCostUsd: PRICING.JEV_USD_PER_INPUT_TOKEN,
    requestId,
    metadata: {
      alert_id: alertId,
      brand: input.brand,
      source,
      is_clone_p: row.is_clone_p,
      clone_tactic: row.clone_tactic,
      attack_intent: row.attack_intent,
      model_id: res.model,
      prompt_version: JEV_PROMPT_VERSION,
      latency_ms: res.elapsedMs,
    },
  });
  return {
    kind: "ok",
    isCloneP: row.is_clone_p,
    inputTokens: res.usage.inputTokens,
    latencyMs: res.elapsedMs,
  };
}
