import { inngest } from "@askarthur/scam-engine/inngest/client";
import { recordLaneError, recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { mapWithConcurrency } from "@askarthur/utils/concurrency";
import {
  fetchNetcraftSubmissionUrls,
  planReconcile,
  slimUrls,
  type ReconcileAlert,
  type ReconcileFetch,
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
 * v314: every matched alert also gets Netcraft's own verdict persisted
 * (submitted_to.netcraft.url_state / url_state_reason), and takedown_at is
 * dated from Netcraft's classification_log when it has one — see
 * record_netcraft_url_verdicts.
 * It NEVER downgrades weaponised/taken_down/dormant. This is the single Netcraft
 * verdict source — the rollup poll stays dark.
 *
 * v249 — this is also the ONLY place the escalation outcome can be observed.
 * `weaponised` rows now enter the worklist: until they did, nothing could ever
 * advance an alert past weaponisation, so `re_taken_down` (escalated AND
 * taken_down) was structurally unsatisfiable and the refileToTakedown duration
 * leg was permanently n=0 — 17 filed issues with no measurable result. The
 * no-downgrade rule that used to be implied by the worklist filter now lives in
 * apply_netcraft_reconcile itself, with a mirror in classifyByUrlState: for a
 * weaponised row, only `malicious` moves it, and it moves forward.
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

// Bounded so a run reliably COMPLETES within the finish budget. History: 60
// timed out (2026-07-10: ~2-3 uuids/min when each uuid was its own queued
// step); 12 held but left each uuid revisited only every ~3.7 days. v316 fetches
// all uuids in ONE budgeted step at FETCH_CONCURRENCY in flight, so the batch
// size no longer multiplies queue waits; anything the budget can't reach is
// simply left for the next run.
const UUID_LIMIT = 24;
// v316: one budgeted fetch step replaces a step per uuid, so the per-run batch
// can double without re-opening the 2026-07-10 timeout: 24 uuids × 2 keyless
// GETs at 4 in flight ≈ 12 sequential round-trips, well inside the budget.
// Unchanged verdicts back off to 72 h (v316), so the pool shrinks, not grows.
const FETCH_CONCURRENCY = 4;
const FETCH_WALL_CLOCK_MS = 180_000;
const CADENCE_HOURS = 24;
const MAX_AGE_DAYS = 30;

interface ReconcileGroup {
  netcraft_uuid: string;
  alerts: ReconcileAlert[];
}

// inngest-finish-budget: 6 boundaries — load-worklist, fetch-all (budgeted
// 180 s), apply-all, page-on-outage, log-cost, log-cost-quiet (exclusive).
export const cloneWatchNetcraftReconcile = inngest.createFunction(
  {
    id: "shopfront-clone-netcraft-reconcile",
    name: "Clone-Watch: Netcraft per-URL lifecycle reconciler",
    retries: 2,
    singleton: { mode: "skip" },
    concurrency: { limit: 1 },
    // 8m: 6 counted boundaries × 30 s queue wait + the 180 s in-step fetch
    // budget + slack (ADR-0019; inngestFinishBudgets.test.ts). Was 15m when
    // every uuid cost two queued steps; the batched shape (v316) removes that
    // queue-wait multiplier, which was the long pole.
    timeouts: { finish: "8m" },
  },
  [
    // Twice daily (v284). Two 24-uuid runs (v316); unchanged verdicts back off
    // to 72 h, so live verdicts are followed at ~12–24 h latency. The 24h
    // CADENCE_HOURS throttle means the 22:00 run picks up DIFFERENT uuids
    // than 10:00 did rather than re-checking them, and `singleton: skip`
    // makes an overrun harmless.
    { cron: "0 10 * * *" },
    { cron: "0 22 * * *" },
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
        const { data, error } = await sb.rpc("list_clone_alerts_for_netcraft_reconcile", {
          p_max_age_days: MAX_AGE_DAYS,
          p_uuid_limit: UUID_LIMIT,
          p_cadence_hours: CADENCE_HOURS,
        });
        // A worklist read failure is a failure, not a quiet day (it used to
        // fall through to the nothing_pending Outcome Row).
        if (error) {
          await recordLaneError("shopfront-clone-netcraft-reconcile", error.message, {
            stage: "load_worklist",
          });
          throw new Error(`list_clone_alerts_for_netcraft_reconcile: ${error.message}`);
        }
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
        // One outcome row per run (#1145). The digest's silent-zero detector
        // judges this lane ABSENT when no lifecycle_reconcile row lands inside
        // 26h, and "nothing pending" used to write nothing. Its silent-zero
        // shape is uuids=0 on THREE consecutive rows — 36h with nothing to
        // reconcile against ~10 resubmits/day is a broken worklist RPC, not a
        // quiet day, so the quiet row is deliberately allowed to count.
        await step.run("log-cost-quiet", () =>
          recordLaneOutcome("shopfront-clone-netcraft-reconcile", 0, {
            reason: "nothing_pending",
            uuids: 0,
            taken_down: 0,
            declined: 0,
          }),
        );
        return { ok: true, uuids: 0, taken_down: 0, declined: 0 };
      }

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

      // ONE fetch step for every uuid (bounded parallelism, soft-fail per
      // uuid), then ONE apply step. Was two steps per uuid: ~54 steps/day and
      // a 13.6 min worst case against the 15 min finish (audit 2026-09-22).
      const fetches = await budgetedStep(
        step,
        "fetch-all",
        FETCH_WALL_CLOCK_MS,
        async (budget) => {
          const out: ReconcileFetch[] = [];
          await mapWithConcurrency(groups, FETCH_CONCURRENCY, async (g) => {
            if (budget.expired()) return; // unfetched → retried next run
            const f = await fetchNetcraftSubmissionUrls(g.netcraft_uuid);
            out.push({
              uuid: g.netcraft_uuid,
              alerts: g.alerts,
              ok: f.ok,
              status: f.status,
              isArchived: f.isArchived,
              urls: slimUrls(f.urls),
              submission: { log: f.submissionLog, submittedAt: f.submittedAt },
            });
          });
          return out;
        },
      );

      const plan = planReconcile(fetches as ReconcileFetch[]);
      if (plan.failedUuids.length) {
        logger.warn("netcraft-reconcile: fetch non-200", {
          uuids: plan.failedUuids,
        });
      }

      await step.run("apply-all", async () => {
        // v314: Netcraft's own verdict + clock FIRST, so a vendor-dated
        // takedown_at wins and apply's witnessed now()-stamp only fills rows
        // Netcraft's log could not date.
        if (plan.verdicts.length) {
          const { error } = await sb.rpc("record_netcraft_url_verdicts", {
            p_verdicts: plan.verdicts,
          });
          if (error) {
            throw new Error(
              `record_netcraft_url_verdicts failed (${plan.verdicts.length}): ${error.message}`,
            );
          }
        }
        await apply(plan.takenDown, "taken_down", true);
        await apply(plan.declined, "declined", false);
        await apply(plan.other, null, false);
        // Takedowns are rare + valuable → always-ship audit event (once/run).
        if (plan.takenDown.length) {
          logEnforcementEvent("actioned", {
            alertId: plan.takenDown[0],
            domain: "netcraft-reconcile",
            channel: "netcraft",
            runId,
            extra: { via: "reconcile", count: plan.takenDown.length },
          });
        }
      });

      const counts = {
        takenDown: plan.takenDown.length,
        declined: plan.declined.length,
        other: plan.other.length,
        archived: plan.archived,
        errors: plan.errors,
        weaponisedNoThreats: plan.weaponisedNoThreats,
        unfetched: groups.length - fetches.length,
      };

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

      await step.run("log-cost", () =>
        recordLaneOutcome("shopfront-clone-netcraft-reconcile", groups.length, {
          uuids: groups.length,
          ...counts,
        }),
      );

      logger.info("netcraft-reconcile: complete", { uuids: groups.length, ...counts });
      return { ok: true, uuids: groups.length, ...counts };
    },
  ),
);
