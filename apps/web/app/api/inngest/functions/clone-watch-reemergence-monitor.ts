import { Resolver } from "node:dns/promises";

import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";

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
const DNS_TIMEOUT_MS = 4000;

interface ReemergenceRow {
  case_id: number;
  clone_alert_id: number;
  candidate_domain: string;
  channel: string;
}

/** True if the domain resolves (A or NS records); false if it doesn't; null on
 *  an inconclusive error (timeout/servfail) so we don't false-flag a re-emergence. */
async function domainResolves(domain: string): Promise<boolean | null> {
  const r = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  try {
    const a = await r.resolve4(domain).catch(() => [] as string[]);
    if (a.length > 0) return true;
    const ns = await r.resolveNs(domain).catch(() => [] as string[]);
    return ns.length > 0;
  } catch {
    return null; // inconclusive — skip this round rather than risk a false reopen
  }
}

export const cloneWatchReemergenceMonitor = inngest.createFunction(
  {
    id: "shopfront-clone-reemergence-monitor",
    name: "Clone-Watch: takedown re-emergence monitor",
    retries: 1,
    concurrency: { limit: 1 },
    timeouts: { finish: "5m" },
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
        return { ok: true, checked: 0, reemerged: 0 };
      }

      let checked = 0;
      let reemerged = 0;

      for (const c of cases) {
        const didReemerge = await step.run(`recheck-${c.case_id}`, async () => {
          const resolves = await domainResolves(c.candidate_domain);
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

      await step.run("log-cost", async () => {
        logCost({
          feature: "clone_enforcement",
          provider: "internal",
          operation: "reemergence_batch",
          units: checked,
          unitCostUsd: 0,
          metadata: { checked, reemerged },
        });
      });

      logger.info("clone-watch re-emergence monitor: complete", {
        checked,
        reemerged,
      });

      return { ok: true, checked, reemerged };
    },
  ),
);
