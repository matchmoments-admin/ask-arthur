import { inngest } from "@askarthur/scam-engine/inngest/client";
import { CLONE_WATCH_NETCRAFT_AUTO_EVENT } from "@askarthur/scam-engine/inngest/events";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

/**
 * Clone-Watch — Netcraft AUTO-report producer (PR3).
 *
 * Today a clone only reaches Netcraft when a human manually triages it
 * (the admin triage route emits CLONE_WATCH_TRIAGED_EVENT). That leaves the
 * high-confidence branded tail unreported. This cron sweeps clones the Haiku
 * preclassifier judged a likely clone (is_clone AND confidence >= threshold)
 * that target a real brand, aren't FP-denylisted, and haven't been submitted,
 * and emits one shopfront/clone.netcraft-auto.v1 per candidate.
 *
 * That event is a SECOND trigger on the existing clone-watch-submit-netcraft
 * worker (NOT on notify-brand), so auto-reporting submits to Netcraft without
 * sending any brand email. The worker's idempotency(alertId) + the
 * submitted_to.netcraft dedup + its 30/hr rate-limit + FP_BRAND_DENYLIST all
 * still apply, so this never double-reports and stays a good citizen. Netcraft
 * re-verifies every submission before any blocklisting.
 *
 * Triple-gated: FF_SHOPFRONT_CLONE_NETCRAFT_AUTO (this producer) +
 * FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT + FF_SHOPFRONT_CLONE_OUTREACH (the worker).
 * Default OFF — flip only after the dry-run count is reviewed.
 *
 * Cron 09:30 UTC — after the 09:00 urlscan submit + preclassify have settled.
 * Also fires on a manual-trigger event for the one-off backlog run.
 */

const BATCH_LIMIT = 100;
const MIN_CONFIDENCE = 0.7;

/** Row shape returned by list_clone_alerts_pending_netcraft_auto. */
export interface NetcraftAutoCandidate {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string;
  severity_tier: string | null;
  signals: unknown;
}

interface NetcraftAutoEvent {
  name: typeof CLONE_WATCH_NETCRAFT_AUTO_EVENT;
  id: string;
  data: {
    alertId: number;
    brand: string;
    candidateDomain: string;
    candidateUrl: string;
    severityTier: string;
    signalType: string;
    score: number;
    triagedAt: string;
  };
}

/**
 * Pure mapping from candidate rows → per-candidate auto-report events. Mirrors
 * the payload the admin triage route builds for CLONE_WATCH_TRIAGED_EVENT
 * (signalType/score read off signals[0]); the worker parses both shapes with
 * parseCloneWatchTriagedData. `triagedAt` is passed in (deterministic id stays
 * `clone-netcraft-auto:<id>` so re-runs dedup at the Inngest layer).
 */
export function buildNetcraftAutoEvents(
  candidates: NetcraftAutoCandidate[],
  triagedAt: string,
): NetcraftAutoEvent[] {
  return candidates.map((c) => {
    const signal = Array.isArray(c.signals) ? c.signals[0] : null;
    const signalType =
      signal &&
      typeof signal === "object" &&
      "signal_type" in signal &&
      typeof (signal as { signal_type?: unknown }).signal_type === "string"
        ? (signal as { signal_type: string }).signal_type
        : "unknown";
    const score =
      signal &&
      typeof signal === "object" &&
      "score" in signal &&
      typeof (signal as { score?: unknown }).score === "number"
        ? (signal as { score: number }).score
        : 0;
    return {
      name: CLONE_WATCH_NETCRAFT_AUTO_EVENT,
      id: `clone-netcraft-auto:${c.id}`,
      data: {
        alertId: c.id,
        brand: c.inferred_target_domain,
        candidateDomain: c.candidate_domain,
        candidateUrl: c.candidate_url,
        severityTier: c.severity_tier ?? "low",
        signalType,
        score,
        triagedAt,
      },
    };
  });
}

export const cloneWatchNetcraftAuto = inngest.createFunction(
  {
    id: "shopfront-clone-netcraft-auto",
    name: "Clone-Watch: Netcraft auto-report producer (gated)",
    retries: 1,
    singleton: { mode: "skip" },
    timeouts: { finish: "4m" },
  },
  [
    { cron: "30 9 * * *" },
    { event: "shopfront/clone.netcraft-auto.producer.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-netcraft-auto" },
    async ({ step }) => {
      if (!featureFlags.shopfrontCloneNetcraftAuto) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_NETCRAFT_AUTO disabled" };
      }
      // The worker would no-op without these anyway; gate the producer too so we
      // don't enqueue events that can't be actioned.
      if (
        !featureFlags.shopfrontCloneSubmitNetcraft ||
        !featureFlags.shopfrontCloneOutreach
      ) {
        return { skipped: true, reason: "netcraft_submit_or_outreach_disabled" };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const candidates = await step.run("load-candidates", async () => {
        const { data, error } = await sb.rpc(
          "list_clone_alerts_pending_netcraft_auto",
          { p_limit: BATCH_LIMIT, p_min_confidence: MIN_CONFIDENCE },
        );
        if (error) {
          logger.error("netcraft-auto: candidate fetch failed", {
            error: error.message,
          });
          return [] as NetcraftAutoCandidate[];
        }
        return (data as NetcraftAutoCandidate[] | null) ?? [];
      });

      if (candidates.length === 0) {
        return { ok: true, candidates: 0, enqueued: 0 };
      }

      const enqueued = await step.run("emit-events", async () => {
        const events = buildNetcraftAutoEvents(
          candidates,
          new Date().toISOString(),
        );
        await inngest.send(events);
        return events.length;
      });

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_netcraft_auto",
          provider: "netcraft",
          operation: "enqueue_batch",
          units: enqueued,
          unitCostUsd: 0, // keyless intake
          metadata: { candidates: candidates.length, enqueued },
        });
      });

      logger.info("netcraft-auto: enqueued", {
        candidates: candidates.length,
        enqueued,
      });

      return { ok: true, candidates: candidates.length, enqueued };
    },
  ),
);
