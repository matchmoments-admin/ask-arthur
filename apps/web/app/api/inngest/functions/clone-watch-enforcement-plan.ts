import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import {
  CLONE_WATCH_WEAPONISED_EVENT,
  parseCloneWatchWeaponisedData,
} from "@askarthur/scam-engine/inngest/events";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import {
  selectChannels,
  type EnforcementAlert,
} from "@/lib/clone-watch/enforcement/matrix";

/**
 * Clone-Watch enforcement — PLAN step (Wave 1 PR 1.2).
 *
 * Consumes shopfront/clone.weaponised.v1 (emitted when our urlscan verdict flips
 * a lookalike to 'weaponised') and opens one enforcement CASE per applicable
 * channel in shopfront_takedown_attempts — the audit-ready record SPF buyers pay
 * for. This step opens cases only; it performs NO outbound reporting. Every
 * domain-level send stays human-gated behind the /admin enforcement tab and the
 * per-channel flags — the itch.io false-takedown invariant. The reversible auto
 * channels (APWG/OpenPhish) are opened as 'queued'/'auto' and actioned by the
 * separate flag-gated execute step (PR 1.3).
 *
 * Gated by FF_CLONE_ENFORCEMENT + feature_brakes.clone_enforcement. A$0.
 */

const BRAKE = "clone_enforcement";

interface AlertRow {
  candidate_url: string;
  candidate_domain: string;
  attribution: EnforcementAlert["attribution"];
}

export const cloneWatchEnforcementPlan = inngest.createFunction(
  {
    id: "shopfront-clone-enforcement-plan",
    name: "Clone-Watch: enforcement plan (open cases)",
    retries: 2,
    concurrency: { limit: 3 },
    timeouts: { finish: "3m" },
  },
  { event: CLONE_WATCH_WEAPONISED_EVENT },
  withAxiomLogging(
    { fnId: "shopfront-clone-enforcement-plan" },
    async ({ event, step, runId }) => {
      if (!featureFlags.cloneEnforcement) {
        return { skipped: true, reason: "FF_CLONE_ENFORCEMENT disabled" };
      }
      const braked = await step.run("check-brake", () => isFeatureBraked(BRAKE));
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const data = parseCloneWatchWeaponisedData(event.data);
      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const alert = await step.run("load-alert", async () => {
        const { data: row } = await sb
          .from("shopfront_clone_alerts")
          .select("candidate_url, candidate_domain, attribution")
          .eq("id", data.alertId)
          .maybeSingle();
        return (row as AlertRow | null) ?? null;
      });

      if (!alert) {
        return { skipped: true, reason: "alert_not_found", alertId: data.alertId };
      }

      const plans = selectChannels({
        candidateUrl: alert.candidate_url,
        candidateDomain: alert.candidate_domain,
        attribution: alert.attribution,
      });

      // Open (or merge) one case per channel. merge_takedown_case dedupes to the
      // single open case per (alert, channel), so a re-emitted weaponised event
      // won't fan out duplicates.
      const opened = await step.run("open-cases", async () => {
        let count = 0;
        for (const plan of plans) {
          const { error } = await sb.rpc("merge_takedown_case", {
            p_alert_id: data.alertId,
            p_channel: plan.channel,
            p_autonomy: plan.autonomy,
            p_acts_on_parked: plan.actsOnParked,
            p_status: "queued",
            p_evidence: {
              via: data.via,
              candidate_url: alert.candidate_url,
              ...(plan.deepLink ? { deep_link: plan.deepLink } : {}),
              ...(plan.note ? { note: plan.note } : {}),
            },
            p_external_ref: null,
            p_next_action_at: null,
          });
          if (error) {
            throw new Error(
              `merge_takedown_case(${plan.channel}) failed for alert ${data.alertId}: ${error.message}`,
            );
          }
          count++;
        }
        return count;
      });

      await step.run("log-cost", async () => {
        logCost({
          feature: "clone_enforcement",
          provider: "internal",
          operation: "plan_open_cases",
          units: opened,
          unitCostUsd: 0,
          metadata: {
            alert_id: data.alertId,
            candidate_domain: alert.candidate_domain,
            channels: plans.map((p) => p.channel),
            via: data.via,
          },
        });
      });

      // Reported-takedown observability — one always-ship event per weaponised
      // lookalike (rare + audit-critical), with the channel plan attached.
      logEnforcementEvent("cases_opened", {
        alertId: data.alertId,
        domain: alert.candidate_domain,
        channel: "plan",
        runId,
        extra: {
          via: data.via,
          opened,
          channels: plans.map((p) => p.channel),
          human_channels: plans
            .filter((p) => p.autonomy !== "auto")
            .map((p) => p.channel),
        },
      });

      logger.info("clone-watch enforcement plan: cases opened", {
        alertId: data.alertId,
        opened,
      });

      return { ok: true, alertId: data.alertId, casesOpened: opened };
    },
  ),
);
