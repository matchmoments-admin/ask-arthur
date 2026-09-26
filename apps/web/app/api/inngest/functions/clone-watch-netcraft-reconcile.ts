import { inngest } from "@askarthur/scam-engine/inngest/client";
import { recordLaneError, recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
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
import { laneCrons, laneGate } from "@/lib/laneHealth";
import { html, joinHtml } from "@askarthur/utils/html";
import {
  readWeaponisedLiveness,
  WEAPONISED_LIVENESS,
  type LivenessTarget,
} from "@/lib/clone-watch/weaponised-liveness";
import {
  escalateVendorGap,
  VENDOR_GAP_ESCALATION,
  type VendorGapRow,
} from "@/lib/clone-watch/vendor-gap-escalation";

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
 * v329 (#1234) — the lane is also the OUTCOME observer for weaponised clones,
 * in two steps that run on every run, quiet Netcraft worklist or not:
 *   - liveness-sweep: a DNS-only read of every weaponised alert (no urlscan
 *     quota, no 30-day window). NXDOMAIN twice >= 12 h apart moves it to
 *     `dormant` with a witnessed `offline_since` (weaponised-liveness.ts,
 *     record_weaponised_liveness). 142 weaponised on 2026-09-26, 63 NXDOMAIN.
 *   - escalate-vendor-gap: a weaponised clone Netcraft still grades clean
 *     after its own escalation path ran out pages the operator, then is
 *     stamped `submitted_to.vendor_gap` (vendor-gap-escalation.ts). 76 met
 *     the bar on 2026-09-26; none had ever reached a human lever.
 *
 * See docs/plans/clone-watch-brand-story-reporting.md §3 Part A.
 */

// Bounded so a run reliably COMPLETES within the finish budget. History: 60
// timed out (2026-07-10: ~2-3 uuids/min when each uuid was its own queued
// step); 12 held but left each uuid revisited only every ~3.7 days. v316 fetches
// all uuids in ONE budgeted step at FETCH_CONCURRENCY in flight, so the batch
// size no longer multiplies queue waits; anything the budget can't reach is
// simply left for the next run.
// 40 (was 24, #1231): the 10:00 run hit 24/24 on 2026-09-25 and 23 the day
// before, with 34 uuids in the 30-day window. 40 × 2 GETs at 4 in flight is
// ~20 sequential round-trips — still well inside FETCH_WALL_CLOCK_MS.
export const UUID_LIMIT = 40;
// v316: one budgeted fetch step replaces a step per uuid, so the per-run batch
// can double without re-opening the 2026-07-10 timeout: 24 uuids × 2 keyless
// GETs at 4 in flight ≈ 12 sequential round-trips, well inside the budget.
// Unchanged verdicts back off to 72 h (v316), so the pool shrinks, not grows.
const FETCH_CONCURRENCY = 4;
const FETCH_WALL_CLOCK_MS = 180_000;
const CADENCE_HOURS = 24;
const MAX_AGE_DAYS = 30;
// v329: in-step budget for the weaponised DNS sweep. 142 names at 16 in
// flight measured ~10 s (2026-09-26); a lookup caps at 4 s per query.
const LIVENESS_WALL_CLOCK_MS = 60_000;

interface ReconcileGroup {
  netcraft_uuid: string;
  alerts: ReconcileAlert[];
}

// inngest-finish-budget: 8 boundaries — load-worklist, fetch-all (budgeted
// 180 s), apply-all, page-on-outage, liveness-sweep (budgeted 60 s, v329),
// escalate-vendor-gap (v329), log-cost, log-cost-quiet (exclusive).
export const cloneWatchNetcraftReconcile = inngest.createFunction(
  {
    id: "shopfront-clone-netcraft-reconcile",
    name: "Clone-Watch: Netcraft per-URL lifecycle reconciler",
    retries: 2,
    singleton: { mode: "skip" },
    concurrency: { limit: 1 },
    // 9m: 8 counted boundaries × 30 s queue wait + the 180 s fetch and 60 s
    // liveness in-step budgets + slack (ADR-0019; inngestFinishBudgets.test.ts).
    // Was 15m when every uuid cost two queued steps (v316), 8m until v329
    // added the liveness sweep and the vendor-gap escalation.
    timeouts: { finish: "9m" },
  },
  [
    // Twice daily (v284). Two 24-uuid runs (v316); unchanged verdicts back off
    // to 72 h, so live verdicts are followed at ~12–24 h latency. The 24h
    // CADENCE_HOURS throttle means the 22:00 run picks up DIFFERENT uuids
    // than 10:00 did rather than re-checking them, and `singleton: skip`
    // makes an overrun harmless.
    ...laneCrons("shopfront-clone-netcraft-reconcile"),
    { event: "shopfront/clone.netcraft-reconcile.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-netcraft-reconcile" },
    async ({ step, runId }) => {
      // Flag gate declared once, in LANE_SHAPES (the digest reads the same list).
      const gate = laneGate("shopfront-clone-netcraft-reconcile");
      if (!gate.ok) return { skipped: true, reason: gate.reason };

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // v329 — weaponised outcome observation (#1234). Runs on BOTH paths
      // below: a quiet Netcraft worklist says nothing about the weaponised
      // set. Neither step throws — an RPC error (e.g. this code deployed
      // before v329 is applied) or a failed Telegram send becomes a null
      // count plus the message in the Outcome Row, which the digest's
      // silent-zero shape for this lane reads (laneHealth.ts). The Netcraft
      // half is already applied by then and must still write its row.
      const observeWeaponisedOutcomes = async () => {
        const liveness = await budgetedStep(
          step,
          "liveness-sweep",
          LIVENESS_WALL_CLOCK_MS,
          async (budget) => {
            // Weaponised rows daily, plus clones this sweep moved to dormant
            // weekly — a lifted registrar hold must be seen (review #1254).
            const { data, error } = await sb.rpc("list_weaponised_for_liveness", {
              p_limit: WEAPONISED_LIVENESS.limit,
              p_cadence_hours: WEAPONISED_LIVENESS.cadenceHours,
              p_dormant_cadence_hours: WEAPONISED_LIVENESS.dormantCadenceHours,
            });
            if (error) return { error: `list: ${error.message}` };
            const rows =
              (data as Array<LivenessTarget & { due_total: number }> | null) ?? [];
            // due_total is counted before the RPC's LIMIT: a truncated sweep
            // reports what it left behind, not a clean zero.
            const due = rows.length ? Number(rows[0]!.due_total) : 0;
            const sweep = await readWeaponisedLiveness(rows, budget);
            const zero = {
              checked: 0,
              present: 0,
              gone_unconfirmed: 0,
              offline_confirmed: 0,
              inconclusive: 0,
              re_emerged: 0,
            };
            if (sweep.reads.length === 0) return { due, unreached: sweep.unreached, ...zero };
            const rec = await sb.rpc("record_weaponised_liveness", {
              p_results: sweep.reads,
              p_confirm_hours: WEAPONISED_LIVENESS.confirmHours,
            });
            if (rec.error) return { error: `record: ${rec.error.message}` };
            const r = (Array.isArray(rec.data) ? rec.data[0] : rec.data) as
              | Record<string, number>
              | undefined;
            return {
              due,
              unreached: sweep.unreached,
              checked: Number(r?.checked ?? 0),
              present: Number(r?.present ?? 0),
              gone_unconfirmed: Number(r?.gone_unconfirmed ?? 0),
              offline_confirmed: Number(r?.offline_confirmed ?? 0),
              inconclusive: Number(r?.inconclusive ?? 0),
              re_emerged: Number(r?.re_emerged ?? 0),
            };
          },
        );

        // list → page → mark in ONE step (vendor-gap-escalation.ts owns the
        // order and never throws): a failed page stamps nothing, so the rows
        // re-list next run; a memoised success never re-pages.
        const vendorGap = await step.run("escalate-vendor-gap", () =>
          escalateVendorGap({
            list: async () => {
              const { data, error } = await sb.rpc("list_netcraft_vendor_gap", {
                p_min_issue_age_hours: VENDOR_GAP_ESCALATION.minIssueAgeHours,
                p_limit: VENDOR_GAP_ESCALATION.limit,
              });
              return error
                ? { error: error.message }
                : { rows: (data as VendorGapRow[] | null) ?? [] };
            },
            send: (message) => sendAdminTelegramMessage(message),
            mark: async (ids) => {
              const { data, error } = await sb.rpc("mark_netcraft_vendor_gap_escalated", {
                p_alert_ids: ids,
                p_min_issue_age_hours: VENDOR_GAP_ESCALATION.minIssueAgeHours,
              });
              return error ? { error: error.message } : { marked: Number(data ?? 0) };
            },
            // One audit event per alert, with its real domain.
            audit: (row) =>
              logEnforcementEvent("declined", {
                alertId: row.id,
                domain: row.candidate_domain,
                channel: "netcraft",
                runId,
                extra: {
                  reason: "vendor_gap_escalated",
                  basis: row.basis,
                  url_state: row.url_state,
                },
              }),
          }),
        );

        return {
          ...("error" in liveness
            ? { liveness_checked: null, liveness_error: liveness.error }
            : {
                liveness_due: liveness.due,
                liveness_checked: liveness.checked,
                liveness_present: liveness.present,
                liveness_gone_unconfirmed: liveness.gone_unconfirmed,
                offline_confirmed: liveness.offline_confirmed,
                liveness_inconclusive: liveness.inconclusive,
                liveness_unreached: liveness.unreached,
                re_emerged: liveness.re_emerged,
              }),
          vendor_gap_escalated: vendorGap.escalated,
          vendor_gap_paged: vendorGap.paged,
          ...(vendorGap.unpaged !== undefined ? { vendor_gap_unpaged: vendorGap.unpaged } : {}),
          ...(vendorGap.error !== undefined ? { vendor_gap_error: vendorGap.error } : {}),
        };
      };

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
        const outcome = await observeWeaponisedOutcomes();
        await step.run("log-cost-quiet", () =>
          recordLaneOutcome("shopfront-clone-netcraft-reconcile", 0, {
            reason: "nothing_pending",
            uuids: 0,
            taken_down: 0,
            declined: 0,
            ...outcome,
          }),
        );
        return { ok: true, uuids: 0, taken_down: 0, declined: 0, ...outcome };
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
            joinHtml([
              html`⚠️ <b>Clone-watch — Netcraft reconcile degraded</b>`,
              html`Fetch errors: <b>${counts.errors}/${groups.length}</b> uuids`,
              "Likely a Netcraft outage / rate-limit. Lifecycle + takedown-KPI update was skipped for the failed batch; the cadence throttle retries them next run.",
            ], "\n"),
          );
        });
      }

      const outcome = await observeWeaponisedOutcomes();

      await step.run("log-cost", () =>
        recordLaneOutcome("shopfront-clone-netcraft-reconcile", groups.length, {
          uuids: groups.length,
          ...counts,
          cap: UUID_LIMIT,
          cap_reached: groups.length >= UUID_LIMIT,
          ...outcome,
        }),
      );

      logger.info("netcraft-reconcile: complete", {
        uuids: groups.length,
        ...counts,
        ...outcome,
      });
      return { ok: true, uuids: groups.length, ...counts, ...outcome };
    },
  ),
);
