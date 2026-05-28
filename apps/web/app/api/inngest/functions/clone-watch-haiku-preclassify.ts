import { z } from "zod";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import {
  CLONE_WATCH_PRECLASSIFY_REQUESTED_EVENT,
  parseCloneWatchPreclassifyRequestedData,
} from "@askarthur/scam-engine/inngest/events";
import { callClaudeJson } from "@askarthur/scam-engine/anthropic";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

/**
 * PR-D2 (#498) — Haiku pre-classifier for clone-watch candidates.
 *
 * Triggered by `shopfront/clone.preclassify-requested.v1` events fanned
 * out from the daily NRD ingest. For each candidate domain we ask
 * Claude Haiku 4.5 to classify it across four dimensions:
 *   1. is_clone (bool) + confidence (0..1)
 *   2. clone_tactic — typosquat / homograph / brandjack / lookalike_tld /
 *      subdomain_abuse / compound_word / unrelated / parked / other
 *   3. attack_intent — credential_phishing / payment_fraud / etc.
 *   4. risk_indicators — array of pre-defined signals
 *
 * Output lands in `clone_watch_classifications` (sibling table per
 * ADR-0005) via `record_clone_watch_classification` RPC. The operator
 * dashboard reads this for pre-ranked queue ordering. Future B2B intel
 * endpoint (PR-D3) + cross-feature signal hydration (PR-D4) + auto-FP
 * (PR-D5) consume this same data.
 *
 * Pre-rank ONLY at this stage. No auto-FP — that's PR-D5 gated on
 * back-test data. Auto-TP is never safe (outbound email).
 *
 * Gating: FF_SHOPFRONT_CLONE_PRECLASSIFY (default OFF, canary). Cost-brake
 * `shopfront_clone_outreach` aware (skip + log on engage). Costs land
 * under feature='shopfront_clone_preclassify' for /admin/costs dashboard.
 *
 * Idempotency: event.data.alertId. Re-classification (e.g. after a
 * prompt rubric change) requires a new event id; the RPC's UPSERT
 * makes the row write itself idempotent.
 *
 * Concurrency: {limit: 3}. Matches urlscan to avoid bursty Anthropic
 * usage that could trigger rate limits.
 *
 * Plan: docs/plans/clone-watch-outreach.md §15 Phase E follow-up.
 */

// Prompt rubric version. Bump on every change so trend queries can
// filter to a consistent classifier. The DB persists this alongside
// each row.
const PROMPT_VERSION = "v1";

// System prompt — cached via cache_control:ephemeral (callClaudeJson
// default). Static across calls so the Anthropic cache hits.
const SYSTEM_PROMPT = `You are a phishing/clone classifier for an Australian scam-detection
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
const ClassificationOutputSchema = z.object({
  is_clone: z.boolean(),
  confidence: z.number().min(0).max(1),
  clone_tactic: z.enum([
    "typosquat",
    "homograph",
    "brandjack",
    "lookalike_tld",
    "subdomain_abuse",
    "compound_word",
    "unrelated",
    "parked",
    "other",
  ]),
  attack_intent: z.enum([
    "credential_phishing",
    "payment_fraud",
    "malware_delivery",
    "investment_scam",
    "fake_marketplace",
    "crypto_scam",
    "support_scam",
    "unknown",
  ]),
  risk_indicators: z
    .array(
      z.enum([
        "urgency_words",
        "payment_form_url",
        "login_form_url",
        "crypto_address",
        "fake_promotion",
        "suspicious_tld",
        "new_registration",
      ]),
    )
    .default([]),
  reason: z.string().min(1).max(500),
});

export type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;

export const cloneWatchHaikuPreclassify = inngest.createFunction(
  {
    id: "shopfront-clone-haiku-preclassify",
    name: "Clone-Watch: Haiku pre-classifier",
    retries: 2,
    concurrency: { limit: 3 },
    // Idempotency keyed on the EVENT id, not event.data.alertId. The daily
    // fan-out now stamps the event id with the run date
    // (`clone-watch-preclassify:<alertId>:<YYYY-MM-DD>`), so a row that did NOT
    // get a classification row on its first attempt (FF was off, cost-brake
    // engaged, supabase blip, or retries exhausted) is re-fanned with a FRESH
    // id on the next daily run and gets another chance — instead of being
    // PERMANENTLY stranded by an alertId-keyed idempotency record (verified
    // 2026-05-29: 6 rows from the 05-27 batch were stuck unclassified for ~2
    // days under the old key). Re-spend is prevented at the source: the
    // `list_clone_alerts_pending_preclassify` selector excludes any alert that
    // already has a classifications row, so only genuinely-pending alerts are
    // ever re-fanned. The record_clone_watch_classification UPSERT remains the
    // belt-and-braces write-idempotency guard.
    idempotency: "event.id",
    timeouts: { finish: "2m" },
  },
  { event: CLONE_WATCH_PRECLASSIFY_REQUESTED_EVENT },
  async ({ event, step }) => {
    const data = parseCloneWatchPreclassifyRequestedData(event.data);

    if (!featureFlags.shopfrontClonePreclassify) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_PRECLASSIFY disabled" };
    }

    const sb = createServiceClient();
    if (!sb) return { skipped: true, reason: "supabase_unavailable" };

    // Cost-brake check. `shopfront_clone_outreach` is the shared brake
    // across all clone-watch sub-features (notify, netcraft, urlscan,
    // and now preclassify). Skip + log when engaged.
    const brakeEngaged = await step.run("check-brake", async () => {
      const { data: row, error } = await sb
        .from("feature_brakes")
        .select("paused_until")
        .eq("feature", "shopfront_clone_outreach")
        .maybeSingle();
      if (error) {
        logger.warn("clone-watch preclassify: brake lookup failed", {
          error: error.message,
        });
        return true; // conservative
      }
      return Boolean(
        row?.paused_until && new Date(row.paused_until).getTime() > Date.now(),
      );
    });
    if (brakeEngaged) {
      return { skipped: true, reason: "cost_brake_engaged" };
    }

    const userMessage = JSON.stringify({
      brand: data.brand,
      candidate_domain: data.candidateDomain,
      candidate_url: data.candidateUrl,
    });

    // Call Haiku with tool-use forced JSON output (matches the pattern
    // proven on Reddit Intel). Cache the system prompt (default) so
    // repeat calls within the cache TTL hit at ~10x lower cost.
    //
    // Error path (local-ultrareview F5): emit a $0 `_error` cost-telemetry
    // row BEFORE re-throwing so Inngest's retry+failure surface in the
    // health-digest aggregator (matches `reddit-intel-error` pattern).
    // Without this row, a degraded Anthropic endpoint produces invisible
    // failures — the only signal is the absence of clone_watch_classifications
    // rows, which the operator wouldn't notice for hours.
    const callResult = await step.run("classify-haiku", async () => {
      try {
        return await callClaudeJson({
          model: "HAIKU_4_5",
          system: SYSTEM_PROMPT,
          user: userMessage,
          userIsTrusted: true, // structured envelope, not raw user text
          schema: ClassificationOutputSchema,
          maxTokens: 256,
          cacheSystem: true,
          useToolUse: true,
          toolName: "submit_classification",
          requestId: `clone-watch-preclassify:${data.alertId}`,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logCost({
          feature: "shopfront_clone_preclassify_error",
          provider: "anthropic",
          operation: "classify_error",
          units: 0,
          unitCostUsd: 0,
          requestId: `clone-watch-preclassify:${data.alertId}`,
          metadata: {
            alert_id: data.alertId,
            brand: data.brand,
            error_message: errorMessage.slice(0, 500),
            model_id: "claude-haiku-4-5-20251001",
            prompt_version: PROMPT_VERSION,
          },
        });
        throw err; // Re-throw so Inngest applies retries:2 + finally fails the run
      }
    });

    const classification = callResult.result;

    // Persist via the v157 idempotent UPSERT RPC.
    await step.run("persist", async () => {
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
        throw new Error(`record_clone_watch_classification: ${error.message}`);
      }
    });

    // Cost telemetry. units = total token count so dashboard slices by
    // tokens/day cleanly. estimatedCostUsd already accounts for cache
    // hits (cacheReadTokens × cacheReadUsdPerToken).
    await step.run("log-cost", async () => {
      const totalTokens =
        callResult.usage.inputTokens + callResult.usage.outputTokens;
      logCost({
        feature: "shopfront_clone_preclassify",
        provider: "anthropic",
        operation: callResult.cacheHit ? "classify_cache_hit" : "classify",
        units: totalTokens,
        unitCostUsd:
          totalTokens > 0 ? callResult.estimatedCostUsd / totalTokens : 0,
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
    });

    logger.info("clone-watch preclassify: done", {
      alertId: data.alertId,
      brand: data.brand,
      is_clone: classification.is_clone,
      confidence: classification.confidence,
      clone_tactic: classification.clone_tactic,
      input_tokens: callResult.usage.inputTokens,
      output_tokens: callResult.usage.outputTokens,
      cost_usd: callResult.estimatedCostUsd,
    });

    return {
      ok: true,
      alertId: data.alertId,
      is_clone: classification.is_clone,
      confidence: classification.confidence,
      clone_tactic: classification.clone_tactic,
      attack_intent: classification.attack_intent,
    };
  },
);

// Export the schema + prompt version for unit testing.
export { ClassificationOutputSchema, PROMPT_VERSION, SYSTEM_PROMPT };
