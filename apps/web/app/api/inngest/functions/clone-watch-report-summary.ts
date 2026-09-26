import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { getActiveWatchlist } from "@askarthur/scam-engine/active-watchlist";
import { priorMonthStart } from "@/app/api/inngest/functions/report-brand-stewardship";
import {
  logCoverageChange,
  planCoverageSync,
} from "@/lib/clone-watch/record-coverage";
import { loadCardInputs } from "@/lib/clone-watch/report-card-data";
import {
  buildReportCard,
  buildTrendRows,
} from "@/lib/clone-watch/report-card";
import { upsertSummary } from "@/lib/clone-watch/report-summary";
import {
  MONTHLY_STORE_WRITTEN_EVENT,
  loadStoreV2Inputs,
  readMonthFrozenAt,
  shouldEmitStoreWritten,
  writeMonthlyStats,
  type MonthlyStoreWrittenData,
  type StoreWriteStatus,
} from "@/lib/clone-watch/monthly-brand-store";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { laneCrons } from "@/lib/laneHealth";
import {
  computeAndRecordReadiness,
  type ReadinessRunResult,
} from "@/lib/clone-watch/readiness-data";

const MANUAL_TRIGGER_EVENT = "clone-watch/report-summary.manual-trigger.v1";

/**
 * clone-watch-report-summary — durable monthly Clone Watch snapshot.
 *
 * Runs on the 1st of each month (an hour after the internal digest), computes
 * the PRIOR calendar month's figures via getCloneWatchReportCard() — the single
 * source of truth that reconciles to the digest — and UPSERTs one row into
 * clone_watch_report_summary (v189). The durable spine for the LinkedIn
 * automation (MoM deltas + the edition record), the future public monthly-index
 * pages, and raw-row JSONB pruning.
 *
 * Lives in its own function (not folded into clone-watch-internal-digest)
 * because the two have different cadences and failure modes, and a snapshot
 * that fails should not take an operator email down with it.
 *
 * It USED to live here for a worse reason, recorded so nobody restores it:
 * report-card-data.ts imported `buildRegistrarRollup` FROM the digest, so
 * importing the card back into the digest closed a value cycle — Inngest
 * topology dictated by an inverted import. `buildRegistrarRollup` now lives in
 * lib/clone-watch/clone-metrics.ts and no `lib/` Module imports from
 * app/api/inngest at all, so that constraint is gone.
 *
 * PUBLISHED MONTHS ARE FROZEN (v319). This run is the ONE producer of the
 * monthly per-brand store (clone_watch_monthly_brand_stats); the first write of
 * a month freezes it, and a later run for the same month — a retry, a
 * backfill, a methodology change — writes NOTHING (neither the store nor the
 * summary row). Before v319 every re-run restated the month: June, July and
 * August were all rewritten on 2026-09-04. The freeze is enforced in SQL
 * (write_clone_watch_monthly_stats + a guard trigger), not only here.
 *
 * Manual trigger: { periodMonth?: "YYYY-MM", republish?: true }.
 *   - periodMonth alone writes a month that has never been published (a
 *     backfill) and is a no-op on a frozen one;
 *   - republish: true is the ONE deliberate restatement path. It rewrites the
 *     summary + store and re-stamps frozen_at (the previous stamp is returned
 *     and warn-logged), then re-triggers brand stewardship for the month.
 * The summary upsert still OMITS published_post_urn, so even a re-publish
 * never wipes the recorded LinkedIn post URN (the publish step owns it).
 *
 * Completion event: once the month's store is in place this emits
 * `clone-watch/monthly-store.written.v1`, which report-brand-stewardship
 * consumes. Stewardship used to run on its own cron two hours BEFORE this one
 * and refold the same alerts itself; it now reads the store this run wrote.
 *
 * Cheap: one getCloneWatchReportCard call (2 SELECTs) + one UPSERT, monthly —
 * well under the pg-stuck-query-watchdog's 10-min threshold.
 */
export const cloneWatchReportSummary = inngest.createFunction(
  {
    id: "clone-watch-report-summary",
    name: "Clone-Watch: monthly report summary snapshot",
    // Raised (#1069): step boundaries queue for the account's 5 Hobby-plan
    // concurrency slots (~30–60s each under contention); the old budget
    // cancelled healthy runs. Finite per ADR-0019; floor guarded by
    // inngestFinishBudgets.test.ts.
    // 3 step sites x 30s of account-concurrency queue wait + 60s slack = 150s
    // floor, comfortably inside 360s. Was 5 sites; compute/upsert/trend-rows
    // merged into one step (see below), which removes two boundaries to queue
    // for AND one full pagination of the month. Budget deliberately left at 6m:
    // the merged step now does two fetches and two writes back-to-back, so the
    // headroom moved from queue-wait to in-step work rather than disappearing.
    // Verified by apps/web/__tests__/inngestFinishBudgets.test.ts.
    // #1237 added compute-readiness: now 5 step.run sites + 1 sendEvent, and
    // the step's compute is bounded in-step by READINESS_WALL_CLOCK_MS (90s,
    // readiness-data.ts — the budget test adds every *_WALL_CLOCK_MS it
    // finds, so it is restated here): 6 x 30s + 90s + 60s = 330s, inside 360s.
    // READINESS_WALL_CLOCK_MS = 90_000
    timeouts: { finish: "6m" },
    retries: 2,
  },
  [
    // 1st of month, 11:00 UTC (after the 10:00 internal digest)
    ...laneCrons("clone-watch-report-summary"),
    { event: MANUAL_TRIGGER_EVENT }, // { periodMonth?: "YYYY-MM", republish?: true }
  ],
  withAxiomLogging(
    { fnId: "clone-watch-report-summary" },
    async ({ event, step }) => {
      // A cron tick carries a payload too ({ cron }), so "is this manual" is
      // decided by the event NAME, never by whether data is present.
      const scheduled = event?.name !== MANUAL_TRIGGER_EVENT;
      const manual = scheduled
        ? {}
        : ((event?.data ?? {}) as { periodMonth?: string; republish?: boolean });
      const override = manual.periodMonth;
      const republish = manual.republish === true;

      const periodYm = await step.run("compute-period", async () => {
        const start = override
          ? new Date(`${override.slice(0, 7)}-01T00:00:00Z`)
          : priorMonthStart(new Date());
        if (Number.isNaN(start.getTime())) {
          throw new Error(`invalid periodMonth override "${override}"`);
        }
        return start.toISOString().slice(0, 7); // "YYYY-MM"
      });

      // Record the CURRENT watchlist before computing anything (#1075).
      //
      // Ordering is load-bearing: "monitored in month M" is defined as present
      // in the snapshot at the start of M and at the start of M+1, and this run
      // IS the start of M+1. Snapshotting after the summary would leave the
      // month it is reporting on ungated.
      //
      // Never fails the run: a coverage write that errors must not cost the
      // month's report. The trend gate fails closed on a missing record, so the
      // worst case is trend claims suppressed for the affected brands — loud in
      // the caveat line rather than silently wrong.
      const coverage = await step.run("snapshot-watchlist-coverage", async () => {
        try {
          const sb = createServiceClient();
          if (!sb) return { skipped: "supabase_unavailable" };

          const { data, error } = await sb
            .from("brand_coverage_history")
            .select("brand_normalized, covered_to")
            .is("covered_to", null);
          if (error) throw new Error(error.message);

          const asOf = new Date().toISOString().slice(0, 10);
          const plan = planCoverageSync(
            await getActiveWatchlist(),
            data ?? [],
            asOf,
          );

          if (plan.toAdd.length > 0) {
            const ins = await sb.from("brand_coverage_history").insert(plan.toAdd);
            if (ins.error) throw new Error(ins.error.message);
          }
          if (plan.toClose.length > 0) {
            const upd = await sb
              .from("brand_coverage_history")
              .update({ covered_to: asOf })
              .in("brand_normalized", plan.toClose)
              .is("covered_to", null);
            if (upd.error) throw new Error(upd.error.message);
          }
          logCoverageChange(plan, asOf);
          return {
            added: plan.toAdd.length,
            closed: plan.toClose.length,
            unchanged: plan.unchanged,
            // Present only when the planner refused a suspiciously large set of
            // closures — surfaced in the run output so an operator reading the
            // Inngest run sees it without going to Axiom.
            ...(plan.closuresWithheld
              ? { closuresWithheld: plan.closuresWithheld }
              : {}),
          };
        } catch (err) {
          logger.error("clone-watch: coverage snapshot failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return { errored: true };
        }
      });

      // ONE load, BOTH folds, both writes — in a single step.
      //
      // This used to be two steps that each did their own read, so the current
      // month was paginated TWICE per run (`compute-summary` built the card,
      // `write-trend-rows` re-fetched the identical rows to build the trend
      // rows). Now `loadCardInputs` runs once and the two pure folds share it.
      //
      // Kept as one step deliberately: Inngest serialises a step's return
      // value, and CardInputs carries thousands of alert rows, so it cannot
      // cross a step boundary. Folding the writes in alongside keeps the rows
      // inside the step and costs one fewer boundary to queue for — which is
      // what actually bites on the 5-slot Hobby plan (ADR-0019, #1069).
      //
      // Retry-safe: the freeze check runs first, so a retry after the store
      // write committed sees a frozen month and writes nothing.
      const result = await step.run("compute-and-write-summary", async () => {
        const periodMonth = `${periodYm}-01`;
        const sb = createServiceClient();
        if (!sb) throw new Error("service client unavailable");

        // Published already? Then this run restates nothing — not the store,
        // not the summary row — unless the operator asked for it.
        const frozenAt = await readMonthFrozenAt(sb, periodMonth);
        if (frozenAt && !republish) {
          return {
            period: periodMonth,
            storeStatus: "frozen" as StoreWriteStatus,
            frozenAt,
            skipped: "frozen" as const,
          };
        }

        const inputs = await loadCardInputs(periodYm);
        const card = buildReportCard(inputs);
        if (card.total === 0) {
          return {
            period: card.periodMonth,
            storeStatus: "empty" as StoreWriteStatus,
            frozenAt: null,
            skipped: "no_clones" as const,
          };
        }
        // Shared writer (report-summary.ts) — omits published_post_urn so a
        // re-publish preserves a URN the LinkedIn publish step recorded.
        await upsertSummary(sb, card);
        // The monthly per-brand + per-registrar store, through the ONE SQL
        // writer: atomic, and it refuses a frozen month unless `republish`.
        //
        // v325: the month-end liveness snapshot (written at 01:00 on the 1st
        // by clone-watch-month-end-liveness) and the feed denominator. Read
        // here, on the write path only; a missing or partial snapshot
        // (no clone_liveness_runs row / row count mismatch) persists
        // active_stock_eom NULL — never a fabricated 0.
        const v2 = await loadStoreV2Inputs(sb, inputs.window);
        const trendRows = buildTrendRows({ ...inputs, ...v2 });
        const stockMeasured = trendRows.brandRows.some(
          (r) => r.active_stock_eom !== null,
        );
        if (!stockMeasured) {
          logger.warn("clone-watch-report-summary: no month-end liveness snapshot", {
            period: card.periodMonth,
            stockState: v2.stockState,
            readError: v2.stockReadError,
            consequence: "active_stock_eom NULL for every brand this month",
          });
        }
        const store = await writeMonthlyStats(sb, trendRows, { republish });
        if (store.status === "republished") {
          // Rare and deliberate — always-ship so the restatement is on record.
          logger.warn("clone-watch-report-summary: month RE-PUBLISHED", {
            period: card.periodMonth,
            previousFrozenAt: store.previousFrozenAt,
            frozenAt: store.frozenAt,
            brandRows: store.brandRows,
          });
        } else if (store.status === "frozen") {
          // Lost a race with another writer between the check and the write.
          logger.warn("clone-watch-report-summary: month frozen mid-run", {
            period: card.periodMonth,
            frozenAt: store.frozenAt,
          });
        }
        return {
          period: card.periodMonth,
          storeStatus: store.status as StoreWriteStatus,
          frozenAt: store.frozenAt,
          previousFrozenAt: store.previousFrozenAt,
          total: card.total,
          brands: card.brands,
          brandRows: store.brandRows,
          registrarRows: store.registrarRows,
          zeroRows: trendRows.brandRows.filter((r) => r.clones === 0).length,
          stockMeasured,
          stockState: v2.stockState,
          sweptDomains: v2.sweptDomains,
          // false = taken_down_in_month persisted as null (not measured).
          takedownEventsRead: inputs.takedownEvents !== undefined,
          // Vendor-gap clock medians for the month cohort (null = leg empty).
          declineToWeaponiseMedianH:
            card.durations.declineToWeaponise.medianHours,
          weaponiseToRefileMedianH: card.durations.weaponiseToRefile.medianHours,
          refileToTakedownMedianH: card.durations.refileToTakedown.medianHours,
          fullLoopMedianH: card.durations.fullLoop.medianHours,
          excludedNegativeN: card.durations.excludedNegativeN,
          anomalousInversionsN: card.durations.anomalousInversionsN,
        };
      });

      // Hand the month to brand stewardship, which reads the store this run
      // just wrote. The id dedupes a retry of this send against the original
      // (Inngest drops a repeated event id within 24h), and a re-publish has a
      // new frozen_at so it gets a new id.
      const emitted = shouldEmitStoreWritten(result.storeStatus, { scheduled });
      if (emitted) {
        const data: MonthlyStoreWrittenData = {
          periodMonth: result.period,
          status: result.storeStatus,
          frozenAt: result.frozenAt,
        };
        await step.sendEvent("emit-monthly-store-written", {
          name: MONTHLY_STORE_WRITTEN_EVENT,
          id: `monthly-store-${result.period}-${result.frozenAt ?? "empty"}`,
          data,
        });
      }

      // One Outcome Row per run (ADR-0025), frozen/no-clone runs included.
      await step.run("log-outcome", () =>
        recordLaneOutcome(
          "clone-watch-report-summary",
          "brandRows" in result ? (result.brandRows ?? 0) : 0,
          {
            ...("skipped" in result
              ? { reason: result.skipped as "frozen" | "no_clones" }
              : {}),
            total: "total" in result ? (result.total ?? 0) : 0,
            brand_rows: "brandRows" in result ? (result.brandRows ?? 0) : 0,
            store_status: result.storeStatus,
            emitted,
            // v325 — how much of the month's store is "watched, nothing
            // found", and whether the stock figure exists at all (false =
            // no month-end snapshot → active_stock_eom NULL, never 0).
            ...("zeroRows" in result
              ? {
                  zero_rows: result.zeroRows,
                  stock_measured: result.stockMeasured,
                  stock_state: result.stockState,
                  swept_domains: result.sweptDomains,
                }
              : {}),
          },
        ),
      );

      // The readiness scorecard (#1237, v335) — computed ONCE a month, here,
      // after the store is frozen (component 5 diffs that frozen store against
      // a live recount) and AFTER log-outcome, so nothing about it can cost
      // the run its Outcome Row. Runs on EVERY path, frozen/no-clone included,
      // so the manual trigger `{ periodMonth }` on an already-frozen month is
      // the on-demand recompute: it restates nothing but this row.
      //
      // Never fails the run (#1260 review L2), at two levels:
      //   - inside the step, computeAndRecordReadiness catches everything and
      //     bounds the compute at READINESS_WALL_CLOCK_MS, returning a
      //     degraded result instead of throwing;
      //   - around the step, a failure the step cannot catch itself (a
      //     platform timeout that exhausts its retries) is caught here.
      // Either way the month is left without a row, which the send gate reads
      // as NOT ready (fail closed) — and the month's report is already written.
      let readiness: ReadinessRunResult;
      try {
        readiness = await step.run("compute-readiness", () =>
          computeAndRecordReadiness(periodYm),
        );
      } catch (err) {
        logger.error("clone-watch-report-summary: readiness step failed", {
          period: periodYm,
          error: err instanceof Error ? err.message : String(err),
          consequence: "no clone_watch_readiness row → brand sends stay in shadow",
        });
        readiness = { errored: "step_failed" };
      }

      if ("skipped" in result) {
        return {
          ok: true,
          readiness,
          period: result.period,
          coverage,
          skipped: result.skipped,
          frozenAt: result.frozenAt,
          emitted,
        };
      }

      logger.info("clone-watch-report-summary: snapshot written", result);
      return { ok: true, ...result, emitted, readiness };
    },
  ),
);
