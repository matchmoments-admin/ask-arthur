import { isFeatureBrakedOrUnknown } from "@askarthur/scam-engine/cost-log";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import { enabledUrlBlocklistDestinations } from "@/lib/onward/destinations";
import {
  enqueueUrlBlocklistReports,
  onwardEventsFor,
  type UrlReportRequest,
} from "@/lib/onward/url-blocklist-report";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";

/**
 * Clone-Watch enforcement — EXECUTE step: a PRODUCER into the onward ledger.
 *
 * Reports weaponised lookalikes to the reversible, re-verified ecosystem
 * blocklists (APWG + OpenPhish) through the SAME path every onward report
 * takes (ADR-0018 amendment 2026-09-23, v318): it enqueues
 * onward_report_log rows with source='clone_alert' via
 * enqueue_onward_url_reports, then fires report.onward.<destination> — and the
 * existing onward-openphish / onward-apwg workers send. This fn sends nothing
 * itself, redeclares no intake address, and opens no case in
 * shopfront_takedown_attempts (that table is the human-gated case workflow
 * only). What one ledger buys: per-URL dedup across scam-report and clone
 * sources, clone sends visible on /admin/onward-reports, and clone sends
 * counted in brand stewardship.
 *
 * SAFETY (itch.io + reporter-reputation):
 *  - Gated FF_CLONE_ENFORCEMENT + FF_CLONE_ENFORCE_AUTO_BLOCKLIST + the
 *    feature_brakes.clone_enforcement kill-switch, AND per destination by the
 *    worker flag (FF_ONWARD_OPENPHISH / FF_ONWARD_APWG) — only enabled
 *    destinations are enqueued, so turning an intake's flag off stops it for
 *    every producer at once.
 *  - Bounded by the SHARED daily cap (CLONE_SUBMISSION_DAILY_CAP) counted
 *    across this path, the human admin send and Netcraft submit
 *    (count_todays_takedown_submissions). Each enqueued row records
 *    `enforcement.queued`, which that counter reads (v318).
 *  - Worklist = list_clone_alerts_pending_onward (v318): lifecycle_state
 *    'weaponised' within the last 14 days, not yet reported to a destination
 *    by alert OR by URL — the same predicate the insert conflicts on, so a
 *    URL already reported from a scam report cannot re-present forever.
 *  - The worker re-verifies 'weaponised' at send time, strips query/fragment
 *    (F8) and honours ONWARD_CANARY_RECIPIENT.
 */

const BRAKE = "clone_enforcement";
const SEND_BATCH_LIMIT = 25;
const DEFAULT_DAILY_CAP = 50;

interface PendingAlertRow {
  clone_alert_id: number;
  candidate_url: string;
  candidate_domain: string;
  target_brand_normalized: string | null;
}

function dailyCap(): number {
  const raw = Number.parseInt(process.env.CLONE_SUBMISSION_DAILY_CAP ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_CAP;
}

// inngest-finish-budget: 7 boundaries — check-brake, check-cap, load-pending,
// enqueue, fire-events, record-queued, log-cost. The per-item send loop (29
// boundaries) moved to the onward workers, one run per ledger row.
export const cloneWatchEnforcementExecute = inngest.createFunction(
  {
    id: "shopfront-clone-enforcement-execute",
    name: "Clone-Watch: enforcement execute (enqueue onward blocklist reports)",
    retries: 2,
    concurrency: { limit: 1 },
    // Finite per ADR-0019; floor guarded by inngestFinishBudgets.test.ts.
    // 7 boundaries × 30s + 60s slack = 4.5m; 6m leaves queue headroom.
    timeouts: { finish: "6m" },
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
      const destinations = enabledUrlBlocklistDestinations(featureFlags);
      if (destinations.length === 0) {
        return { skipped: true, reason: "no_enabled_destinations" };
      }
      const braked = await step.run("check-brake", () => isFeatureBrakedOrUnknown(BRAKE));
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // Shared daily cap. One alert becomes one send PER destination, so the
      // remaining budget buys floor(remaining / destinations) alerts.
      const alertBudget = await step.run("check-cap", async () => {
        const { data } = await sb.rpc("count_todays_takedown_submissions");
        const used = typeof data === "number" ? data : 0;
        const remaining = Math.max(0, dailyCap() - used);
        return Math.floor(remaining / destinations.length);
      });
      if (alertBudget === 0) {
        return { skipped: true, reason: "daily_submission_cap_reached" };
      }

      const pending = await step.run("load-pending", async () => {
        const { data, error } = await sb.rpc("list_clone_alerts_pending_onward", {
          p_destinations: destinations.map((d) => d.destination),
          p_limit: Math.min(SEND_BATCH_LIMIT, alertBudget),
        });
        if (error) {
          throw new Error(`list_clone_alerts_pending_onward: ${error.message}`);
        }
        return (data as PendingAlertRow[] | null) ?? [];
      });

      if (pending.length === 0) {
        await step.run("log-outcome-quiet", () =>
          recordLaneOutcome("shopfront-clone-enforcement-execute", 0, {
            reason: "nothing_pending",
            candidates: 0,
            enqueued: 0,
          }),
        );
        return { ok: true, enqueued: 0, reason: "nothing_pending" };
      }

      const fresh = await step.run("enqueue", () => {
        const rows: UrlReportRequest[] = pending.flatMap((a) =>
          destinations.map((d) => ({
            source: "clone_alert" as const,
            clone_alert_id: a.clone_alert_id,
            destination: d.destination,
            destination_key: d.destinationKey,
            url: a.candidate_url,
          })),
        );
        return enqueueUrlBlocklistReports(sb, rows);
      });

      if (fresh.length > 0) {
        await step.run("fire-events", async () => {
          await inngest.send(onwardEventsFor(fresh));
        });

        // One `enforcement.queued` per enqueued row — the durable audit trail
        // and what the shared daily cap counts. Inside a step so a replay does
        // not double-count against the cap.
        await step.run("record-queued", async () => {
          const byId = new Map(pending.map((a) => [a.clone_alert_id, a]));
          for (const row of fresh) {
            const alert = row.clone_alert_id != null ? byId.get(row.clone_alert_id) : undefined;
            logEnforcementEvent("queued", {
              alertId: row.clone_alert_id ?? 0,
              domain: alert?.candidate_domain ?? "",
              brand: alert?.target_brand_normalized ?? null,
              channel: row.destination,
              autonomy: "auto",
              runId,
              extra: { onward_log_id: row.id, url_key: row.url_key },
            });
          }
        });
      }

      await step.run("log-cost", () =>
        recordLaneOutcome("shopfront-clone-enforcement-execute", fresh.length, {
          enqueued: fresh.length,
          candidates: pending.length,
          destinations: destinations.map((d) => d.destination),
          // Rows the dedup dropped: this alert's URL was already reported to
          // that destination (a race with another producer since the read).
          deduped: pending.length * destinations.length - fresh.length,
        }),
      );

      logger.info("clone-watch enforcement execute: enqueued", {
        enqueued: fresh.length,
        candidates: pending.length,
      });

      return { ok: true, enqueued: fresh.length, candidates: pending.length };
    },
  ),
);
