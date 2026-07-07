import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import { sendOnward } from "@/lib/onward/url-blocklist-report";

/**
 * Clone-Watch enforcement — EXECUTE step (Wave 1 outbound, founder-approved).
 *
 * The ONLY machine-send path. Sends weaponised lookalikes to the reversible,
 * re-verified ecosystem blocklists APWG + OpenPhish (email), then advances the
 * case to 'submitted' and emits the reported-takedown telemetry. Every
 * domain-level lever (registrar/host/UDRP) stays human-gated — this fn never
 * touches a non-'auto' case (the RPC only returns auto APWG/OpenPhish cases).
 *
 * SAFETY (itch.io + reporter-reputation):
 *  - Gated FF_CLONE_ENFORCEMENT + FF_CLONE_ENFORCE_AUTO_BLOCKLIST + the
 *    feature_brakes.clone_enforcement kill-switch.
 *  - Bounded by a SHARED daily cap (CLONE_SUBMISSION_DAILY_CAP) counted across
 *    both this path and the Netcraft submit path, so a ~20% FP rate can't flood
 *    the ecosystem feeds and burn our standing.
 *  - Honours ONWARD_CANARY_RECIPIENT (via sendOnward): the first real sends go
 *    to our own inbox until the format + acceptance are confirmed.
 *  - Only acts on lifecycle_state='weaponised' (our scanner confirmed the phish).
 */

const BRAKE = "clone_enforcement";
const SEND_BATCH_LIMIT = 25;
const DEFAULT_DAILY_CAP = 50;

const INTAKE: Record<string, string> = {
  apwg: "reportphishing@apwg.org",
  openphish: "report@openphish.com",
};

interface PendingSendRow {
  case_id: number;
  clone_alert_id: number;
  channel: string;
  candidate_url: string;
  candidate_domain: string;
  target_brand_normalized: string | null;
}

function dailyCap(): number {
  const raw = Number.parseInt(process.env.CLONE_SUBMISSION_DAILY_CAP ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_CAP;
}

function reportText(row: PendingSendRow): string {
  const brand = row.target_brand_normalized ?? "an Australian brand";
  return [
    `Suspected phishing / brand-impersonation URL reported by Ask Arthur (askarthur.au):`,
    ``,
    `URL: ${row.candidate_url}`,
    `Impersonated brand: ${brand}`,
    ``,
    `This domain was detected as a lookalike of ${brand} and independently`,
    `classified as likely phishing by our automated scan. Please verify and`,
    `action per your process. Reply to this email to dispute.`,
  ].join("\n");
}

export const cloneWatchEnforcementExecute = inngest.createFunction(
  {
    id: "shopfront-clone-enforcement-execute",
    name: "Clone-Watch: enforcement execute (auto blocklist send)",
    retries: 2,
    concurrency: { limit: 1 },
    timeouts: { finish: "5m" },
  },
  [
    { cron: "15 */3 * * *" },
    { event: "shopfront/clone.enforcement-execute.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-enforcement-execute" },
    async ({ step, runId }) => {
      if (!featureFlags.cloneEnforcement) {
        return { skipped: true, reason: "FF_CLONE_ENFORCEMENT disabled" };
      }
      if (!featureFlags.cloneEnforceAutoBlocklist) {
        return { skipped: true, reason: "FF_CLONE_ENFORCE_AUTO_BLOCKLIST disabled" };
      }
      if (!process.env.RESEND_API_KEY) {
        return { skipped: true, reason: "RESEND_API_KEY not set" };
      }
      const braked = await step.run("check-brake", () => isFeatureBraked(BRAKE));
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // Shared daily cap — remaining budget across ALL takedown-submission paths.
      const budget = await step.run("check-cap", async () => {
        const { data } = await sb.rpc("count_todays_takedown_submissions");
        const used = typeof data === "number" ? data : 0;
        return Math.max(0, dailyCap() - used);
      });
      if (budget === 0) {
        return { skipped: true, reason: "daily_submission_cap_reached" };
      }

      const pending = await step.run("load-pending-send", async () => {
        const { data } = await sb.rpc("list_enforcement_cases_pending_send", {
          p_limit: Math.min(SEND_BATCH_LIMIT, budget),
        });
        return (data as PendingSendRow[] | null) ?? [];
      });

      if (pending.length === 0) {
        return { ok: true, sent: 0, reason: "nothing_pending" };
      }

      let sent = 0;
      let errors = 0;

      for (const row of pending) {
        const intake = INTAKE[row.channel];
        if (!intake) continue; // defensive — RPC only returns apwg/openphish

        const outcome = await step.run(`send-${row.case_id}`, async () => {
          try {
            const ref = `clone-${row.case_id}`;
            const result = await sendOnward(intake, ref, reportText(row));
            // Advance the case to submitted (records submitted_at) with the
            // provider message id as the external ref.
            const { error } = await sb.rpc("merge_takedown_case", {
              p_alert_id: row.clone_alert_id,
              p_channel: row.channel,
              p_autonomy: "auto",
              p_acts_on_parked: false,
              p_status: "submitted",
              p_evidence: { intake, report_ref: ref },
              p_external_ref: result?.id ?? null,
              p_next_action_at: null,
            });
            if (error) {
              throw new Error(`merge_takedown_case failed: ${error.message}`);
            }
            // Reported-takedown telemetry (always-ship; inside the step so it
            // fires once). This is the event the founder watches.
            logEnforcementEvent("reported", {
              alertId: row.clone_alert_id,
              caseId: row.case_id,
              domain: row.candidate_domain,
              brand: row.target_brand_normalized,
              channel: row.channel,
              autonomy: "auto",
              runId,
              extra: { intake, provider_message_id: result?.id ?? null },
            });
            return { ok: true as const };
          } catch (err) {
            logger.warn("clone-watch enforcement execute: send failed", {
              caseId: row.case_id,
              channel: row.channel,
              error: err instanceof Error ? err.message : String(err),
            });
            return { ok: false as const };
          }
        });
        if (outcome.ok) sent++;
        else errors++;
      }

      await step.run("log-cost", async () => {
        logCost({
          feature: "clone_enforcement",
          provider: "resend",
          operation: "execute_batch",
          units: sent,
          unitCostUsd: 0,
          metadata: { sent, errors, candidates: pending.length },
        });
      });

      logger.info("clone-watch enforcement execute: complete", {
        sent,
        errors,
        candidates: pending.length,
      });

      return { ok: true, sent, errors, candidates: pending.length };
    },
  ),
);
