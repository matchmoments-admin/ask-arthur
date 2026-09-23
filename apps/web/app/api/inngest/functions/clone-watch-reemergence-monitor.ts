import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import { resolvesToHost } from "@/lib/clone-watch/liveness";
import { recordLaneError, recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";

/**
 * Clone-Watch — takedown re-emergence monitor (Wave 1).
 *
 * A taken-down clone can come back on new hosting. This closes the enforcement
 * loop: for each 'actioned' case, re-resolve the domain's DNS; if it resolves
 * again, reopen the case as 're_emerged' and emit the telemetry the founder
 * watches. Read-only DNS + a case status flip — NO outbound reporting, so it's
 * safe to run independently of the send path.
 *
 * Gated FF_CLONE_ENFORCEMENT + FF_CLONE_REEMERGENCE_MONITOR. Bounded batch,
 * short per-domain DNS timeout, cadence-throttled — completes well under the
 * pg-stuck-query-watchdog edge.
 */

const BATCH_LIMIT = 50;
const CADENCE_HOURS = 24;

interface ReemergenceRow {
  case_id: number;
  clone_alert_id: number;
  candidate_domain: string;
  channel: string;
}


// inngest-finish-budget: 52 boundaries — 2 static + 1 per-case recheck step
// x BATCH_LIMIT (50). See #1074 for the batching fold.
export const cloneWatchReemergenceMonitor = inngest.createFunction(
  {
    id: "shopfront-clone-reemergence-monitor",
    name: "Clone-Watch: takedown re-emergence monitor",
    retries: 1,
    concurrency: { limit: 1 },
    timeouts: { finish: "27m" },
  },
  // Manual-trigger only (no cron). FF_CLONE_ENFORCEMENT +
  // FF_CLONE_REEMERGENCE_MONITOR are dark in prod, so a scheduled tick just
  // burned an execution to early-return (fleet audit 2026-09-16). Invoke on
  // demand via the `shopfront/clone.reemergence.manual-trigger.v1` event.
  // **At launch, restore the sweep by re-adding `{ cron: "45 6 * * *" }`**
  // alongside this event trigger — laneHealth's 26h expectEvery assumes it.
  { event: "shopfront/clone.reemergence.manual-trigger.v1" },
  withAxiomLogging(
    { fnId: "shopfront-clone-reemergence-monitor" },
    async ({ step, runId }) => {
      if (!featureFlags.cloneEnforcement) {
        return { skipped: true, reason: "FF_CLONE_ENFORCEMENT disabled" };
      }
      if (!featureFlags.cloneReemergenceMonitor) {
        return { skipped: true, reason: "FF_CLONE_REEMERGENCE_MONITOR disabled" };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const cases = await step.run("load-actioned", async () => {
        const { data, error } = await sb.rpc("list_takedown_cases_for_reemergence", {
          p_limit: BATCH_LIMIT,
          p_cadence_hours: CADENCE_HOURS,
        });
        // A worklist read failure is a failure, not a quiet day.
        if (error) {
          await recordLaneError("shopfront-clone-reemergence-monitor", error.message, {
            stage: "load_actioned",
          });
          throw new Error(`list_takedown_cases_for_reemergence: ${error.message}`);
        }
        return (data as ReemergenceRow[] | null) ?? [];
      });

      if (cases.length === 0) {
        await step.run("log-outcome-quiet", () =>
          recordLaneOutcome("shopfront-clone-reemergence-monitor", 0, {
            reason: "nothing_due",
            checked: 0,
            reemerged: 0,
          }),
        );
        return { ok: true, checked: 0, reemerged: 0 };
      }

      let checked = 0;
      let reemerged = 0;

      for (const c of cases) {
        const didReemerge = await step.run(`recheck-${c.case_id}`, async () => {
          // Re-emerged = the name points at a host again (A/AAAA), via the ONE
          // DNS Module (liveness.ts). "Not NXDOMAIN" is not enough: a zone
          // still delegated with its A removed is exactly what a takedown
          // leaves behind, and it is not a clone coming back.
          const resolves = await resolvesToHost(c.candidate_domain);
          // Inconclusive: leave the case unstamped so the next cadence retries,
          // rather than recording a "checked, not re-emerged" we cannot prove.
          if (resolves === null) return false;
          const reemergedNow = resolves === true;
          const { error } = await sb.rpc("mark_takedown_reemergence_checked", {
            p_case_id: c.case_id,
            p_reemerged: reemergedNow,
          });
          if (error) {
            throw new Error(
              `mark_takedown_reemergence_checked(${c.case_id}): ${error.message}`,
            );
          }
          if (reemergedNow) {
            logEnforcementEvent("re_emerged", {
              alertId: c.clone_alert_id,
              caseId: c.case_id,
              domain: c.candidate_domain,
              channel: c.channel,
              runId,
            });
          }
          return reemergedNow;
        });
        checked++;
        if (didReemerge) reemerged++;
      }

      await step.run("log-cost", () =>
        recordLaneOutcome("shopfront-clone-reemergence-monitor", checked, {
          checked,
          reemerged,
        }),
      );

      logger.info("clone-watch re-emergence monitor: complete", {
        checked,
        reemerged,
      });

      return { ok: true, checked, reemerged };
    },
  ),
);
