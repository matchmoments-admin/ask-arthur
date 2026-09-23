import { inngest } from "@askarthur/scam-engine/inngest/client";
import { mapWithConcurrency } from "@askarthur/utils/concurrency";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  CLONE_WATCH_PRECLASSIFY_REQUESTED_EVENT,
  parseCloneWatchPreclassifyRequestedData,
} from "@askarthur/scam-engine/inngest/events";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { isPreclassifyBraked } from "@/lib/clone-watch/jev-classify-one";
import {
  ClassificationOutputSchema,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  classifyAlert,
  concurrencyFor,
  preclassifyMode,
  type AlertResult,
  type PreclassifyInput,
} from "@/lib/clone-watch/preclassify-one";
import { laneGate } from "@/lib/laneHealth";

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

// A batch of 5 × Haiku 3 s / 2 in flight ≈ 9 s; 200 s leaves room for a
// slow vendor. Alerts the budget can't reach are left for tomorrow's re-fan.
const BATCH_WALL_CLOCK_MS = 200_000;

// inngest-finish-budget: 2 boundaries — classify-batch (budgeted 200 s, the
// brake read rides inside it), log-outcome.
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
      // Flag gate declared once, in LANE_SHAPES (the digest reads the same list).
      const gate = laneGate("shopfront-clone-haiku-preclassify");
      if (!gate.ok) return { skipped: true, reason: gate.reason };
      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const { alerts, invalid } = alertsFromEvents(events);

      // The brake read rides INSIDE the work step (ADR-0019 bookkeeping rule,
      // the #1069 fold the 2026-09-23 batch rewrite had undone): one step
      // per batch, not two. Fail-closed — a paid vendor call. Memoised with
      // the results, so a replay does not re-read it. `mode` is read once
      // here too, so the Outcome Row's `mode` is the one every alert used.
      const batch = await budgetedStep(
        step,
        "classify-batch",
        BATCH_WALL_CLOCK_MS,
        async (budget) => {
          if (await isPreclassifyBraked()) {
            return { braked: true as const, mode: preclassifyMode(), results: [] };
          }
          const mode = preclassifyMode();
          const out: AlertResult[] = [];
          await mapWithConcurrency(alerts, concurrencyFor(mode), async (a) => {
            if (budget.expired()) return; // unreached → tomorrow's re-fan
            try {
              out.push(await classifyAlert(sb, a, mode));
            } catch (err) {
              // Its `_error` row is already written (both adapters); the
              // others carry on.
              out.push({
                alertId: a.alertId,
                ok: false,
                error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
              });
            }
          });
          return { braked: false as const, mode, results: out };
        },
      );

      if (batch.braked) {
        await step.run("log-outcome", () =>
          recordLaneOutcome("shopfront-clone-haiku-preclassify", 0, {
            reason: "braked",
            alerts: alerts.length,
            classified: 0,
            failed: 0,
          }),
        );
        return { skipped: true, reason: "cost_brake_engaged" };
      }

      const { results, mode } = batch;
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
          mode,
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

// Re-exported for existing importers; the home is lib/clone-watch/preclassify-one.ts.
export { ClassificationOutputSchema, PROMPT_VERSION, SYSTEM_PROMPT, classifyAlert };
export type { AlertResult };
