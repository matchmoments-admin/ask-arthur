// Shared I/O for classifying ONE clone-watch candidate through the Jev
// shadow lane (v311): ask Jev → map answers → UPSERT the sibling row → one
// cost row. Used by the `persist` step of clone-watch-haiku-preclassify
// (source 'live') and by scripts/backfill-jev-classifications.ts (source
// 'backfill'), so there is exactly ONE write path and ONE cost-row shape for
// the lane. Same division of labour as urlscan-submit-one.ts.
//
// Never throws on vendor / shape / persist failure — the live caller runs it
// after Haiku's row is persisted and must not fail that result. Fail-soft is
// acceptable here ONLY because every failure is observable: a $0
// `shopfront_clone_preclassify_jev_error` row keyed on `reason`, and the
// discriminated outcome for the caller's log line. Side-effecting, so it
// lives here rather than in the pure jev-preclassify rubric module.

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
  toJevRpcArgs,
  type JevPreclassifyInput,
} from "@/lib/clone-watch/jev-preclassify";

export const JEV_COST_FEATURE = "shopfront_clone_preclassify_jev";
export const JEV_ERROR_FEATURE = "shopfront_clone_preclassify_jev_error";

export type JevShadowOutcome =
  | { kind: "ok"; isCloneP: number; inputTokens: number; latencyMs: number }
  | { kind: "error"; reason: string };

export interface ClassifyOneWithJevArgs {
  sb: NonNullable<ReturnType<typeof createServiceClient>>;
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
