import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import {
  classifyByUrlState,
  fetchNetcraftSubmissionUrls,
  type ReconcileAlert,
} from "@/lib/clone-watch/netcraft-urls";

/**
 * Clone-Watch — Netcraft PER-URL lifecycle reconciler (PR3.1, Part A).
 *
 * The ~892 auto-submitted clones never had their lifecycle advanced (the rollup
 * poll is dark; the auto submitter never calls advance_clone_lifecycle). So
 * lifecycle_state is stale and the time-to-takedown KPI (fed by
 * submitted_to.netcraft.takedown_at, written only by the dark poll) is starved.
 *
 * This reconciler reads the PER-URL truth from GET /submission/{uuid}/urls (the
 * same keyless source as the false-negative reporter — NOT the buggy rollup) and
 * advances each alert's lifecycle by its OWN url_state:
 *   malicious                 → taken_down (+ stamps takedown_at → feeds the KPI)
 *   no threats / unavailable  → declined   (→ feeds the 6h weaponisation recheck)
 *   suspicious / processing / no-match → unchanged (just stamp reconciled_at)
 * It NEVER downgrades weaponised/taken_down/dormant (the worklist RPC excludes
 * them). This is the single Netcraft verdict source — the rollup poll stays dark.
 *
 * No outbound, no reporter-standing cost → uncapped (unlike the issue reporter);
 * bounded per run by p_uuid_limit + a 24h per-uuid cadence throttle. Daily cron.
 * Gated FF_CLONE_LIFECYCLE_RECONCILE (+ parent FF_SHOPFRONT_CLONE_OUTREACH).
 *
 * TTD honesty (v219): apply_netcraft_reconcile only stamps takedown_at on a
 * WITNESSED transition (the alert already has a reconciled_at), so the first-run
 * backfill of already-actioned clones advances lifecycle to taken_down WITHOUT a
 * takedown_at — they count as taken_down but are excluded from the
 * time-to-takedown KPI (their real takedown time is unknowable). New clones,
 * observed daily from submission, get an accurate (to one cadence) takedown_at.
 *
 * See docs/plans/clone-watch-brand-story-reporting.md §3 Part A.
 */

// Bounded so a run reliably COMPLETES within the finish budget (and thus logs
// its heartbeat + runs the outage-check). Live smoke (2026-07-10) showed 60 was
// too many — Netcraft /urls latency under a burst meant ~2-3 uuids/min, so a
// 60-uuid run hit the 5m budget and was cancelled mid-batch. 12 uuids × 2
// keyless GETs completes with headroom; the 24h cadence throttle + singleton
// grind the ~164 backlog down over a handful of daily runs, self-healing.
const UUID_LIMIT = 12;
const CADENCE_HOURS = 24;
const MAX_AGE_DAYS = 30;

interface ReconcileGroup {
  netcraft_uuid: string;
  alerts: ReconcileAlert[];
}

export const cloneWatchNetcraftReconcile = inngest.createFunction(
  {
    id: "shopfront-clone-netcraft-reconcile",
    name: "Clone-Watch: Netcraft per-URL lifecycle reconciler",
    retries: 2,
    singleton: { mode: "skip" },
    concurrency: { limit: 1 },
    // 8m finish (matches the poll fn) — the slow part is keyless Netcraft HTTP,
    // not a PG backend, so the 10m pg-stuck-query-watchdog is not at risk.
    timeouts: { finish: "8m" },
  },
  [
    { cron: "0 10 * * *" },
    { event: "shopfront/clone.netcraft-reconcile.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-netcraft-reconcile" },
    async ({ step, runId }) => {
      if (!featureFlags.shopfrontCloneOutreach) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_OUTREACH disabled" };
      }
      if (!featureFlags.cloneLifecycleReconcile) {
        return { skipped: true, reason: "FF_CLONE_LIFECYCLE_RECONCILE disabled" };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const groups = await step.run("load-worklist", async () => {
        const { data } = await sb.rpc("list_clone_alerts_for_netcraft_reconcile", {
          p_max_age_days: MAX_AGE_DAYS,
          p_uuid_limit: UUID_LIMIT,
          p_cadence_hours: CADENCE_HOURS,
        });
        return (
          (data as Array<{ netcraft_uuid: string; alerts: unknown }> | null) ?? []
        )
          .map((r) => ({
            netcraft_uuid: r.netcraft_uuid,
            alerts: Array.isArray(r.alerts) ? (r.alerts as ReconcileAlert[]) : [],
          }))
          .filter((g) => g.alerts.length > 0) as ReconcileGroup[];
      });

      if (groups.length === 0) {
        return { ok: true, uuids: 0, taken_down: 0, declined: 0 };
      }

      const counts = { takenDown: 0, declined: 0, other: 0, archived: 0, errors: 0 };

      const apply = async (
        ids: number[],
        toState: string | null,
        stampTakedown: boolean,
      ) => {
        if (ids.length === 0) return;
        const { error } = await sb.rpc("apply_netcraft_reconcile", {
          p_alert_ids: ids,
          p_to_state: toState,
          p_stamp_takedown: stampTakedown,
        });
        if (error) {
          throw new Error(
            `apply_netcraft_reconcile(${toState}) failed (${ids.length}): ${error.message}`,
          );
        }
      };

      for (const group of groups) {
        const uuid = group.netcraft_uuid;
        const allIds = group.alerts.map((a) => a.id);

        const fetched = await step.run(`fetch-${uuid}`, () =>
          fetchNetcraftSubmissionUrls(uuid),
        );

        if (fetched.isArchived) {
          // Submission aged out of Netcraft — leave lifecycle, just stamp
          // reconciled_at so the cadence throttle stops re-fetching it hard.
          counts.archived++;
          await step.run(`archived-${uuid}`, () => apply(allIds, null, false));
          continue;
        }
        if (!fetched.ok) {
          counts.errors++; // transient — no stamp, retried next run
          logger.warn("netcraft-reconcile: fetch non-200", { uuid, status: fetched.status });
          continue;
        }

        const cls = classifyByUrlState(group.alerts, fetched.urls);

        await step.run(`apply-${uuid}`, async () => {
          await apply(cls.takenDown, "taken_down", true);
          await apply(cls.declined, "declined", false);
          await apply(cls.other, null, false);
          // Takedowns are rare + valuable → always-ship audit event (once/uuid).
          if (cls.takenDown.length) {
            logEnforcementEvent("actioned", {
              alertId: cls.takenDown[0],
              domain: uuid,
              channel: "netcraft",
              runId,
              extra: { via: "reconcile", uuid, count: cls.takenDown.length },
            });
          }
        });

        counts.takenDown += cls.takenDown.length;
        counts.declined += cls.declined.length;
        counts.other += cls.other.length;
      }

      // Degraded-run awareness. Hard failures (RPC/DB) throw and are always-ship
      // fn.error via withAxiomLogging. A Netcraft OUTAGE, though, only soft-fails
      // (per-uuid fetch non-200 → counts.errors, no throw), so a run that updated
      // no lifecycle because Netcraft was down would otherwise pass silently.
      // Mirror the poll fn: if ≥50% of a non-trivial batch failed to fetch,
      // always-ship an Axiom warning (logEnforcementEvent uses .warn) + page.
      if (groups.length >= 5 && counts.errors / groups.length >= 0.5) {
        await step.run("page-on-outage", async () => {
          logEnforcementEvent("rejected", {
            alertId: 0,
            domain: "netcraft-reconcile",
            channel: "netcraft",
            runId,
            extra: {
              reason: "reconcile_outage",
              errors: counts.errors,
              uuids: groups.length,
            },
          });
          await sendAdminTelegramMessage(
            [
              "⚠️ <b>Clone-watch — Netcraft reconcile degraded</b>",
              `Fetch errors: <b>${counts.errors}/${groups.length}</b> uuids`,
              "Likely a Netcraft outage / rate-limit. Lifecycle + takedown-KPI update was skipped for the failed batch; the cadence throttle retries them next run.",
            ].join("\n"),
          );
        });
      }

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_netcraft_reconcile",
          provider: "netcraft",
          operation: "lifecycle_reconcile",
          units: groups.length,
          unitCostUsd: 0,
          metadata: { uuids: groups.length, ...counts },
        });
      });

      logger.info("netcraft-reconcile: complete", { uuids: groups.length, ...counts });
      return { ok: true, uuids: groups.length, ...counts };
    },
  ),
);
