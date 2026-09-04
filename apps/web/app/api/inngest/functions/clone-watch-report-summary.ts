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
import { upsertSummary, writeTrendRows } from "@/lib/clone-watch/report-summary";

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
 * Idempotent + backfill-safe: the manual-trigger event carries an optional
 * { periodMonth: "YYYY-MM" } override (used to backfill historical months).
 * The upsert overwrites the metric columns but OMITS published_post_urn, so a
 * re-snapshot never wipes the recorded LinkedIn post URN (the publish step owns
 * that column).
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
    timeouts: { finish: "6m" },
    retries: 2,
  },
  [
    { cron: "0 11 1 * *" }, // 1st of month, 11:00 UTC (after the 10:00 internal digest)
    { event: "clone-watch/report-summary.manual-trigger.v1" }, // { periodMonth?: "YYYY-MM" }
  ],
  withAxiomLogging(
    { fnId: "clone-watch-report-summary" },
    async ({ event, step }) => {
      const override = (event?.data as { periodMonth?: string } | undefined)
        ?.periodMonth;

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
      // what actually bites on the 5-slot Hobby plan (ADR-0019, #1069). Both
      // writes are idempotent, so a retry of the whole step is safe.
      const result = await step.run("compute-and-write-summary", async () => {
        const inputs = await loadCardInputs(periodYm);
        const card = buildReportCard(inputs);
        if (card.total === 0) {
          return { period: card.periodMonth, skipped: "no_clones" as const };
        }
        const sb = createServiceClient();
        if (!sb) throw new Error("service client unavailable");
        // Shared writer (report-summary.ts) — omits published_post_urn so a
        // re-snapshot preserves a URN the LinkedIn publish step recorded.
        await upsertSummary(sb, card);
        // Full per-brand + per-registrar trend rows (v193) — powers per-brand /
        // per-registrar MoM on the owned-media pages. Idempotent delete+insert.
        const trendRows = buildTrendRows(inputs);
        await writeTrendRows(sb, trendRows);
        return {
          period: card.periodMonth,
          total: card.total,
          brands: card.brands,
          brandRows: trendRows.brandRows.length,
          registrarRows: trendRows.registrarRows.length,
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

      if ("skipped" in result) {
        return { ok: true, period: result.period, coverage, skipped: result.skipped };
      }

      logger.info("clone-watch-report-summary: snapshot written", result);
      return { ok: true, ...result };
    },
  ),
);
