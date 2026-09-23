import { z } from "zod";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { mapWithConcurrency } from "@askarthur/utils/concurrency";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  CLONE_WATCH_PRECLASSIFY_REQUESTED_EVENT,
  parseCloneWatchPreclassifyRequestedData,
} from "@askarthur/scam-engine/inngest/events";
import { callClaudeJson } from "@askarthur/scam-engine/anthropic";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCostAsync } from "@/lib/cost-telemetry";
import { buildJevState } from "@/lib/clone-watch/jev-preclassify";
import {
  classifyOneWithJev,
  classifyPrimaryWithJev,
  isPreclassifyBraked,
} from "@/lib/clone-watch/jev-classify-one";
import {
  ATTACK_INTENT_VALUES,
  CLONE_TACTIC_VALUES,
  RISK_INDICATOR_VALUES,
} from "@/lib/clone-watch/preclassify-vocabulary";

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
 *
 * ADR-0026 (2026-09-22): when FF_CLONE_WATCH_JEV_PRIMARY is ON the fn is
 * ONE step, `classify-jev` — Jev produces the clone_watch_classifications
 * row every gate reads (`confidence` = P(clone), thresholds in
 * lib/clone-watch/preclassify-thresholds.ts). The Haiku path below is the
 * rollback (flag OFF), unchanged.
 *
 * Jev SHADOW LANE (v311, 2026-09-21). The tail of the `persist` step, when
 * FF_CLONE_WATCH_JEV_SHADOW is ON (body in lib/clone-watch/jev-classify-one.ts,
 * shared with the backfill script): the same three input
 * fields go to TypeSafe Jev (a decision-only model returning calibrated
 * probabilities) and land in `clone_watch_jev_classifications`, read by
 * NOTHING downstream. Why: Haiku's `confidence` above was measured to have
 * no predictive power over outcomes (see clone-watch-netcraft-auto.ts
 * header + v311's), yet it gates four worklist RPCs. The shadow lane
 * exists to be measured by `clone_watch_jev_calibration()`; the decision
 * rule and delete plan live in docs/ops/clone-watch-config.md.
 */

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
const PROMPT_VERSION = "v2";

// System prompt — cached via cache_control:ephemeral (callClaudeJson
// default). Static across calls so the Anthropic cache hits.
const SYSTEM_PROMPT =
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
const ClassificationOutputSchema = z.object({
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
type PreclassifyInput = ReturnType<typeof parseCloneWatchPreclassifyRequestedData>;

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
 * Classify ONE alert — the whole per-alert contract, unchanged from the
 * one-run-per-alert era: Jev primary (ADR-0026) writes both sibling rows + one
 * cost row; the Haiku rollback path (FF_CLONE_WATCH_JEV_PRIMARY off) calls
 * Claude, persists via the v157 UPSERT, writes its cost row, then the Jev
 * shadow tail (fail-soft). Throws on a vendor or persist failure AFTER writing
 * its `_error` row, exactly as before; the batch catches per alert. No step
 * boundaries in here — the batch owns them.
 */
export async function classifyAlert(
  sb: Sb,
  data: PreclassifyInput,
): Promise<AlertResult> {
  if (featureFlags.cloneWatchJevPrimary) {
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
    throw new Error(`record_clone_watch_classification: ${error.message}`);
  }
  const totalTokens =
    callResult.usage.inputTokens + callResult.usage.outputTokens;
  await logCostAsync({
    feature: "shopfront_clone_preclassify",
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

/** Parse + dedupe a batch's events: one entry per alertId (Inngest dedupes
 *  event ids at ingest; this covers two ids for one alert in one batch).
 *  Unparseable events are counted, never thrown — one bad payload must not
 *  fail the other 49. Pure; exported for tests. */
export function alertsFromEvents(events: ReadonlyArray<{ data?: unknown }>): {
  alerts: PreclassifyInput[];
  invalid: number;
} {
  const byId = new Map<number, PreclassifyInput>();
  let invalid = 0;
  for (const e of events) {
    try {
      const d = parseCloneWatchPreclassifyRequestedData(e.data);
      if (!byId.has(d.alertId)) byId.set(d.alertId, d);
    } catch {
      invalid++;
    }
  }
  return { alerts: [...byId.values()], invalid };
}

/** Inngest plan ceiling for batchEvents.maxSize (Hobby: 5). Exported for the
 *  guard test — exceeding it fails the entire app sync, not just this fn. */
export const INNGEST_PLAN_MAX_BATCH_SIZE = 5;
export const PRECLASSIFY_BATCH_SIZE = INNGEST_PLAN_MAX_BATCH_SIZE;
/** Plan ceiling for batchEvents.timeout (Hobby: 30 s) — the second sync
 *  rejection (#1191's resync: "cannot be longer than 30 seconds"). */
export const INNGEST_PLAN_MAX_BATCH_TIMEOUT_S = 30;
export const PRECLASSIFY_BATCH_TIMEOUT = "30s";

// Jev ~300 ms/call; Haiku ~3 s — both well inside the budget per batch.
const JEV_CONCURRENCY = 4;
const HAIKU_CONCURRENCY = 2;
// A batch of 5 × Haiku 3 s / 2 in flight ≈ 9 s; 200 s leaves room for a
// slow vendor. Alerts the budget can't reach are left for tomorrow's re-fan.
const BATCH_WALL_CLOCK_MS = 200_000;

// inngest-finish-budget: 4 boundaries — check-brake, classify-batch (budgeted
// 200 s), log-outcome, log-outcome-braked (exclusive).
export const cloneWatchHaikuPreclassify = inngest.createFunction(
  {
    id: "shopfront-clone-haiku-preclassify",
    name: "Clone-Watch: pre-classifier (Jev primary, batched)",
    retries: 2,
    // Batched (2026-09-23; plan docs/plans/preclassify-batch-events-2026-09-23.md).
    // Was one run per alert at concurrency 3: ~26 runs holding 3 of the
    // account's 5 slots at 08:31. maxSize is 5 because the current Inngest plan
    // REJECTS a larger batch — and a rejected function fails the WHOLE app sync
    // (`modified:false`: no function change registers). #1190 shipped 50 and
    // the post-deploy resync 400'd with "cannot be larger than 5". A plan
    // upgrade can raise it; inngestBatchLimit.test.ts pins the ceiling.
    // ~26 alerts → ~6 runs, each one budgeted step.
    batchEvents: {
      maxSize: PRECLASSIFY_BATCH_SIZE,
      timeout: PRECLASSIFY_BATCH_TIMEOUT,
    },
    concurrency: { limit: 1 },
    // No `idempotency` — Inngest rejects it with batchEvents. The guarantee it
    // gave lives where it always really lived: the fan-out's event id
    // `clone-watch-preclassify:<alertId>:<YYYY-MM-DD>` is deduplicated by
    // Inngest at ingest (24 h), alertsFromEvents dedupes within a batch, and
    // record_clone_watch_classification is an UPSERT. The daily selector
    // excludes alerts that already have a classification row, so a failed
    // alert is re-fanned tomorrow with a fresh id (the existing backstop).
    timeouts: { finish: "8m" },
  },
  { event: CLONE_WATCH_PRECLASSIFY_REQUESTED_EVENT },
  withAxiomLogging(
    { fnId: "shopfront-clone-haiku-preclassify" },
    async ({ events, step }) => {
      if (!featureFlags.shopfrontClonePreclassify) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_PRECLASSIFY disabled" };
      }
      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const { alerts, invalid } = alertsFromEvents(events);

      // One brake read per batch (fail-closed: a paid vendor call).
      const braked = await step.run("check-brake", () => isPreclassifyBraked());
      if (braked) {
        await step.run("log-outcome-braked", () =>
          recordLaneOutcome("shopfront-clone-haiku-preclassify", 0, {
            reason: "braked",
            alerts: alerts.length,
            classified: 0,
            failed: 0,
          }),
        );
        return { skipped: true, reason: "cost_brake_engaged" };
      }

      const results = await budgetedStep(
        step,
        "classify-batch",
        BATCH_WALL_CLOCK_MS,
        async (budget) => {
          const out: AlertResult[] = [];
          const width = featureFlags.cloneWatchJevPrimary
            ? JEV_CONCURRENCY
            : HAIKU_CONCURRENCY;
          await mapWithConcurrency(alerts, width, async (a) => {
            if (budget.expired()) return; // unreached → tomorrow's re-fan
            try {
              out.push(await classifyAlert(sb, a));
            } catch (err) {
              // Its `_error` row is already written (classifyAlert /
              // classifyPrimaryWithJev); the others carry on.
              out.push({
                alertId: a.alertId,
                ok: false,
                error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
              });
            }
          });
          return out;
        },
      );

      const classified = results.filter((r) => r.ok).length;
      const failed = results.length - classified;
      const unreached = alerts.length - results.length;
      await step.run("log-outcome", () =>
        recordLaneOutcome("shopfront-clone-haiku-preclassify", classified, {
          alerts: alerts.length,
          classified,
          failed,
          unreached,
          invalid,
          mode: featureFlags.cloneWatchJevPrimary ? "jev" : "haiku",
        }),
      );
      logger.info("clone-watch preclassify: batch done", {
        events: events.length,
        alerts: alerts.length,
        classified,
        failed,
        unreached,
        invalid,
      });
      return { ok: true, alerts: alerts.length, classified, failed, unreached, results };
    },
  ),
);

// Export the schema + prompt version for unit testing.
export { ClassificationOutputSchema, PROMPT_VERSION, SYSTEM_PROMPT };
