import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import { isDomainGone } from "@/lib/clone-watch/liveness";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";

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

/** Resolves = true, gone = false, resolver proved nothing = null — via the
 *  ONE DNS check (liveness.ts). The local copy this replaced caught every
 *  lookup error per-call, so a resolver TIMEOUT read as "not resolving" and
 *  its own `null` branch was unreachable. */
async function domainResolves(domain: string): Promise<boolean | null> {
  const gone = await isDomainGone(domain);
  return gone === null ? null : !gone;
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
  [
    { cron: "45 6 * * *" },
    { event: "shopfront/clone.reemergence.manual-trigger.v1" },
  ],
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
        const { data } = await sb.rpc("list_takedown_cases_for_reemergence", {
          p_limit: BATCH_LIMIT,
          p_cadence_hours: CADENCE_HOURS,
        });
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
          const resolves = await domainResolves(c.candidate_domain);
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
