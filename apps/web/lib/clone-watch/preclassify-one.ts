// Classify ONE clone-watch candidate — the pre-classifier Module, with two
// adapters behind one seam (architecture review 2026-09-24, candidate #5):
//
//   jev   — ADR-0026 primary: TypeSafe Jev writes the gate row
//           (lib/clone-watch/jev-classify-one.ts does the vendor I/O).
//   haiku — the rollback (FF_CLONE_WATCH_JEV_PRIMARY off): Claude Haiku 4.5,
//           then the fail-soft Jev shadow tail when FF_CLONE_WATCH_JEV_SHADOW.
//
// Before this Module the Haiku adapter lived inside the Inngest function, so
// the rollback path could only be tested by driving the whole batch handler,
// its cost rows re-typed feature strings the Jev side exports, and a persist
// failure wrote no `_error` row. The Inngest function now owns only batching,
// the budget and the Outcome Row.
//
// Side-effecting (vendor calls + DB writes), so it lives beside
// jev-classify-one.ts and urlscan-submit-one.ts, not in the pure rubric module.

import { z } from "zod";
import type { parseCloneWatchPreclassifyRequestedData } from "@askarthur/scam-engine/inngest/events";
import { callClaudeJson } from "@askarthur/scam-engine/anthropic";
import type { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logCostAsync } from "@/lib/cost-telemetry";
import { buildJevState } from "@/lib/clone-watch/jev-preclassify";
import {
  PRECLASSIFY_COST_FEATURE,
  PRECLASSIFY_ERROR_FEATURE,
  classifyOneWithJev,
  classifyPrimaryWithJev,
} from "@/lib/clone-watch/jev-classify-one";
import {
  ATTACK_INTENT_VALUES,
  CLONE_TACTIC_VALUES,
  RISK_INDICATOR_VALUES,
} from "@/lib/clone-watch/preclassify-vocabulary";

// Prompt rubric version. Bump on every change so trend queries can
// filter to a consistent classifier. The DB persists this alongside
// each row.
// v2 (2026-08-10, #999): the user turn is now wrapped in the injection
// sandwich — `userIsTrusted: true` was removed because candidate_domain and
// candidate_url are attacker-registered strings from the NRD feed. The model
// now sees pre/post instructions and a nonce-tagged delimiter around that
// envelope, so classifications may shift. prompt_version is persisted on
// every clone_watch_classifications row (2,386 of them, all v1 as of
// 2026-08-10), so this bump is what makes the two cohorts separable — a
// discriminator that cannot be reconstructed after the fact.
export const PROMPT_VERSION = "v2";

// System prompt — cached via cache_control:ephemeral (callClaudeJson
// default). Static across calls so the Anthropic cache hits.
export const SYSTEM_PROMPT =
  `You are a phishing/clone classifier for an Australian scam-detection
platform. Given a candidate domain and the brand it might be cloning,
classify it across four dimensions and return JSON only via the
submit_response tool.

DIMENSION 1 — IS_CLONE
A CLONE is a domain registered with deliberate intent to impersonate
the brand for fraudulent purposes. NON-CLONE includes coincidental
name overlap, dictionary words, parked domains, and legitimate
subsidiaries.

DIMENSION 2 — CLONE_TACTIC (one of):
  typosquat       — single-char insertion/deletion/swap (e.g. csrsales)
  homograph       — IDN / unicode confusables (e.g. xn--auspst-9ya)
  brandjack       — brand name + appended word (e.g. nab-secure)
  lookalike_tld   — same name on a different TLD (e.g. nab.shop)
  subdomain_abuse — brand as a subdomain (e.g. nab.evil-host.com)
  compound_word   — brand inside a longer compound (e.g. mynabaccount)
  unrelated       — non-clone, name coincidence
  parked          — non-clone, marketplace-parked
  other

DIMENSION 3 — ATTACK_INTENT (one of):
  credential_phishing | payment_fraud | malware_delivery
  investment_scam | fake_marketplace | crypto_scam
  support_scam | unknown

DIMENSION 4 — RISK_INDICATORS (array, may be empty). Choose any that apply:
  ["urgency_words","payment_form_url","login_form_url",
   "crypto_address","fake_promotion","suspicious_tld","new_registration"]

Always return is_clone, confidence (0..1), clone_tactic, attack_intent,
risk_indicators[], and a one-sentence reason.`.trim();

// Zod schema for tool-use enforced output. The schema is converted to
// JSON Schema by callClaudeJson and passed as the forced tool input,
// so the model can only respond with a valid object — no JSON.parse
// failure modes.
export const ClassificationOutputSchema = z.object({
  is_clone: z.boolean(),
  confidence: z.number().min(0).max(1),
  // Enum values live in lib/clone-watch/preclassify-vocabulary.ts — the one
  // home shared with the Jev shadow lane (v311) so the two classifiers
  // cannot drift apart. The DB CHECK constraints (v157, v311) mirror them.
  clone_tactic: z.enum(CLONE_TACTIC_VALUES),
  attack_intent: z.enum(ATTACK_INTENT_VALUES),
  risk_indicators: z.array(z.enum(RISK_INDICATOR_VALUES)).default([]),
  reason: z.string().min(1).max(500),
});

export type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;
export type PreclassifyInput = ReturnType<
  typeof parseCloneWatchPreclassifyRequestedData
>;

/** Which adapter writes the gate row. ADR-0026: Jev is primary; Haiku is the
 *  rollback (FF_CLONE_WATCH_JEV_PRIMARY off). */
export type PreclassifyMode = "jev" | "haiku";

/** Read once per batch, so every alert in it — and the Outcome Row's `mode` —
 *  agree even if the flag flips mid-run. */
export function preclassifyMode(): PreclassifyMode {
  return featureFlags.cloneWatchJevPrimary ? "jev" : "haiku";
}

/** In-flight vendor calls per batch: Jev ~300 ms/call, Haiku ~3 s. */
export function concurrencyFor(mode: PreclassifyMode): number {
  return mode === "jev" ? 4 : 2;
}

const HAIKU_MODEL_ID = "claude-haiku-4-5-20251001";

/** One alert's outcome inside a batch. */
export type AlertResult =
  | {
      alertId: number;
      ok: true;
      is_clone: boolean;
      confidence: number;
      clone_tactic: string;
      attack_intent: string;
      /** primary = Jev wrote the gate row; ok/error/off = Haiku wrote it and
       *  the Jev shadow tail succeeded / failed / was disabled. */
      jev: "primary" | "ok" | "error" | "off";
    }
  | { alertId: number; ok: false; error: string };

/**
 * Classify ONE alert through `mode`'s adapter — the whole per-alert contract:
 * Jev primary (ADR-0026) writes both sibling rows + one cost row; the Haiku
 * rollback calls Claude, persists via the v157 UPSERT, writes its cost row,
 * then the Jev shadow tail (fail-soft). Throws on a vendor or persist failure
 * AFTER writing its `_error` row, in both adapters; the batch catches per
 * alert. No step boundaries in here — the batch owns them.
 */
export async function classifyAlert(
  sb: Sb,
  data: PreclassifyInput,
  mode: PreclassifyMode = preclassifyMode(),
): Promise<AlertResult> {
  if (mode === "jev") {
    const out = await classifyPrimaryWithJev({
      sb,
      alertId: data.alertId,
      input: data,
      requestId: `clone-watch-preclassify:${data.alertId}`,
    });
    return {
      alertId: data.alertId,
      ok: true,
      is_clone: out.is_clone,
      confidence: out.confidence,
      clone_tactic: out.clone_tactic,
      attack_intent: out.attack_intent,
      jev: "primary",
    };
  }

  // The same three fields the Jev shadow lane sees — built by ONE function
  // so "identical input" is structural, not a claim (v311).
  const userMessage = JSON.stringify(buildJevState(data));
  let callResult;
  try {
    callResult = await callClaudeJson({
      model: "HAIKU_4_5",
      system: SYSTEM_PROMPT,
      // `candidate_domain` / `candidate_url` are attacker-chosen registry
      // strings: JSON.stringify stops break-out, the sandwich handles
      // instruction-shaped text inside a value.
      user: userMessage,
      schema: ClassificationOutputSchema,
      maxTokens: 256,
      cacheSystem: true,
      useToolUse: true,
      toolName: "submit_classification",
      requestId: `clone-watch-preclassify:${data.alertId}`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // $0 `_error` row BEFORE re-throwing — the health digest's only signal of
    // a degraded Anthropic endpoint (local-ultrareview F5). Awaited.
    await logCostAsync({
      feature: PRECLASSIFY_ERROR_FEATURE,
      provider: "anthropic",
      operation: "classify_error",
      units: 0,
      unitCostUsd: 0,
      requestId: `clone-watch-preclassify:${data.alertId}`,
      metadata: {
        alert_id: data.alertId,
        brand: data.brand,
        error_message: errorMessage.slice(0, 500),
        model_id: HAIKU_MODEL_ID,
        prompt_version: PROMPT_VERSION,
      },
    });
    throw err;
  }
  const classification = callResult.result;

  const { error } = await sb.rpc("record_clone_watch_classification", {
    p_alert_id: data.alertId,
    p_brand: data.brand,
    p_candidate_domain: data.candidateDomain,
    p_is_clone: classification.is_clone,
    p_confidence: classification.confidence,
    p_clone_tactic: classification.clone_tactic,
    p_attack_intent: classification.attack_intent,
    p_risk_indicators: classification.risk_indicators,
    p_reason: classification.reason,
    p_model_id: callResult.modelId,
    p_prompt_version: PROMPT_VERSION,
    p_input_tokens: callResult.usage.inputTokens,
    p_output_tokens: callResult.usage.outputTokens,
  });
  if (error) {
    // Same `_error` row as a vendor failure (the Jev adapter already did
    // this; the Haiku adapter threw without one until 2026-09-24, so a
    // rollback-mode persist failure was invisible to the health digest).
    await logCostAsync({
      feature: PRECLASSIFY_ERROR_FEATURE,
      provider: "anthropic",
      // Same operation as the vendor-failure row and the Jev adapter's
      // failures; `stage` says which half failed.
      operation: "classify_error",
      units: 0,
      unitCostUsd: 0,
      requestId: `clone-watch-preclassify:${data.alertId}`,
      metadata: {
        stage: "persist",
        alert_id: data.alertId,
        brand: data.brand,
        error_message: error.message.slice(0, 500),
        model_id: callResult.modelId,
        prompt_version: PROMPT_VERSION,
      },
    });
    throw new Error(`record_clone_watch_classification: ${error.message}`);
  }
  const totalTokens =
    callResult.usage.inputTokens + callResult.usage.outputTokens;
  await logCostAsync({
    feature: PRECLASSIFY_COST_FEATURE,
    provider: "anthropic",
    operation: callResult.cacheHit ? "classify_cache_hit" : "classify",
    units: totalTokens,
    unitCostUsd: totalTokens > 0 ? callResult.estimatedCostUsd / totalTokens : 0,
    requestId: `clone-watch-preclassify:${data.alertId}`,
    metadata: {
      alert_id: data.alertId,
      brand: data.brand,
      is_clone: classification.is_clone,
      confidence: classification.confidence,
      clone_tactic: classification.clone_tactic,
      attack_intent: classification.attack_intent,
      prompt_version: PROMPT_VERSION,
      model_id: callResult.modelId,
      cache_hit: callResult.cacheHit,
      estimated_cost_usd: callResult.estimatedCostUsd,
    },
  });

  // Jev SHADOW LANE (v311) — after Haiku's row + cost row, identical input,
  // read by nothing downstream; fail-soft + UPSERT-idempotent.
  const jev = featureFlags.cloneWatchJevShadow
    ? await classifyOneWithJev({
        sb,
        alertId: data.alertId,
        input: data,
        source: "live",
        requestId: `clone-watch-preclassify-jev:${data.alertId}`,
      })
    : ({ kind: "off" } as const);

  return {
    alertId: data.alertId,
    ok: true,
    is_clone: classification.is_clone,
    confidence: classification.confidence,
    clone_tactic: classification.clone_tactic,
    attack_intent: classification.attack_intent,
    jev: jev.kind === "ok" ? "ok" : jev.kind === "error" ? "error" : "off",
  };
}
