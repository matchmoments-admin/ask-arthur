import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { CLONE_WATCH_SCAN_REQUESTED_EVENT } from "@askarthur/scam-engine/inngest/events";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

/**
 * Clone-Watch — lifecycle re-check loop (Wave 0 PR-B).
 *
 * The founder's "we need to press these somehow" ask, in code. Netcraft grades
 * on LIVE content, so a lookalike that is parked / cloaked / pre-weaponisation
 * at first scan comes back "no threats" (→ lifecycle 'declined') or benign
 * (→ 'monitoring'). Those domains very often weaponise LATER. This cron re-scans
 * the 'monitoring'/'declined' tail on a cadence: it re-emits the existing
 * urlscan scan-requested event (reason='rescan'), and when the re-scan verdict
 * flips to likely_phishing, clone-watch-urlscan-retrieve promotes the alert to
 * 'weaponised' and emits shopfront/clone.weaponised.v1 — the contradiction we
 * exploit ("we saw the phish, Netcraft didn't").
 *
 * Does NO paid work itself (it emits events; urlscan submit/retrieve — already
 * cost-logged + urlscan-flag-gated — do the scanning). Bounded by the per-run
 * candidate limit so it can never fan out an unbounded rescan storm.
 *
 * Gated by FF_SHOPFRONT_CLONE_RECHECK (canary independently of Netcraft
 * submission) + a feature_brakes.shopfront_clone_recheck operator kill-switch.
 */

const RECHECK_BATCH_LIMIT = 50; // × 4 runs/day = ≤200 rescans/day, bounded
const RECHECK_CADENCE_HOURS = 6; // don't re-scan the same domain more often
const BRAKE = "shopfront_clone_recheck";

interface RecheckRow {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  lifecycle_state: string;
  urlscan_classification: string | null;
  recheck_count: number;
  last_rechecked_at: string | null;
}

export const cloneWatchLifecycleRecheck = inngest.createFunction(
  {
    id: "shopfront-clone-lifecycle-recheck",
    name: "Clone-Watch: lifecycle re-check loop",
    retries: 1,
    concurrency: { limit: 1 },
    // <5 min on a healthy DB (RECHECK_BATCH_LIMIT emits + marks); 5m cap keeps
    // it under the pg-stuck-query-watchdog edge.
    timeouts: { finish: "5m" },
  },
  [
    { cron: "0 */6 * * *" },
    { event: "shopfront/clone.lifecycle-recheck.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-lifecycle-recheck" },
    async ({ step }) => {
      if (!featureFlags.shopfrontCloneRecheck) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_RECHECK disabled" };
      }
      // The re-check loop's ONLY job is to trigger urlscan re-scans. If the
      // urlscan pipeline can't run, don't mark candidates rechecked (which would
      // bump last_rechecked_at and exclude them for a full cadence with no scan).
      if (!featureFlags.shopfrontCloneUrlscan) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_URLSCAN disabled" };
      }
      if (!process.env.URLSCAN_API_KEY) {
        return { skipped: true, reason: "URLSCAN_API_KEY not set" };
      }
      const braked = await step.run("check-brake", () => isFeatureBraked(BRAKE));
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const candidates = await step.run("load-recheck-candidates", async () => {
        const { data } = await sb.rpc("list_clone_alerts_for_recheck", {
          p_limit: RECHECK_BATCH_LIMIT,
          p_cadence_hours: RECHECK_CADENCE_HOURS,
        });
        return (data as RecheckRow[] | null) ?? [];
      });

      if (candidates.length === 0) {
        return { ok: true, rechecked: 0, reason: "nothing_due" };
      }

      // Re-emit the existing urlscan scan-requested event (reason='rescan') for
      // each candidate. Id-keyed on the last-rechecked timestamp so a replay of
      // this step doesn't double-submit, but a genuine next-cadence run does.
      await step.run("trigger-rescans", async () => {
        await inngest.send(
          candidates.map((c) => ({
            name: CLONE_WATCH_SCAN_REQUESTED_EVENT,
            id: `clone-recheck-${c.id}-${c.recheck_count}`,
            data: {
              alertId: c.id,
              candidateUrl: c.candidate_url,
              candidateDomain: c.candidate_domain,
              reason: "rescan" as const,
            },
          })),
        );
      });

      // Mark each candidate rechecked (bump recheck_count + last_rechecked_at)
      // via the same guarded transition RPC, holding lifecycle_state unchanged
      // so it drops out of the cadence window until the re-scan verdict lands.
      await step.run("mark-rechecked", async () => {
        for (const c of candidates) {
          const { error } = await sb.rpc("advance_clone_lifecycle", {
            p_alert_id: c.id,
            p_to_state: c.lifecycle_state, // no-op state change; just re-check bookkeeping
            p_mark_rechecked: true,
          });
          if (error) {
            throw new Error(
              `advance_clone_lifecycle(mark_rechecked) failed for alert ${c.id}: ${error.message}`,
            );
          }
        }
      });

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_recheck",
          provider: "internal",
          operation: "recheck_batch",
          units: candidates.length,
          unitCostUsd: 0,
          metadata: {
            rechecked: candidates.length,
            declined: candidates.filter((c) => c.lifecycle_state === "declined")
              .length,
            monitoring: candidates.filter(
              (c) => c.lifecycle_state === "monitoring",
            ).length,
          },
        });
      });

      logger.info("clone-watch lifecycle re-check: complete", {
        rechecked: candidates.length,
      });

      return { ok: true, rechecked: candidates.length };
    },
  ),
);
