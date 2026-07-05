import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { priorMonthStart } from "@/app/api/inngest/functions/report-brand-stewardship";
import {
  getCloneWatchReportCard,
  getCloneWatchTrendRows,
} from "@/lib/clone-watch/report-card-data";
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
 * deliberately: report-card-data.ts imports buildRegistrarRollup FROM the
 * digest, so importing getCloneWatchReportCard back into the digest would be a
 * cycle. This function is downstream of report-card-data with no such edge.
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
    timeouts: { finish: "2m" },
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

      // Reconciled figures — identical numbers to /admin/report-card + the digest.
      const card = await step.run("compute-summary", () =>
        getCloneWatchReportCard(periodYm),
      );

      if (card.total === 0) {
        return { ok: true, period: card.periodMonth, skipped: "no_clones" };
      }

      const result = await step.run("upsert-summary", async () => {
        const sb = createServiceClient();
        if (!sb) throw new Error("service client unavailable");
        // Shared writer (report-summary.ts) — omits published_post_urn so a
        // re-snapshot preserves a URN the LinkedIn publish step recorded.
        await upsertSummary(sb, card);
        return { period: card.periodMonth, total: card.total, brands: card.brands };
      });

      // Full per-brand + per-registrar trend rows (v193) — powers per-brand /
      // per-registrar MoM on the owned-media pages. Idempotent delete+insert.
      const trend = await step.run("write-trend-rows", async () => {
        const sb = createServiceClient();
        if (!sb) throw new Error("service client unavailable");
        const rows = await getCloneWatchTrendRows(periodYm);
        await writeTrendRows(sb, rows);
        return {
          brandRows: rows.brandRows.length,
          registrarRows: rows.registrarRows.length,
        };
      });

      logger.info("clone-watch-report-summary: snapshot written", { ...result, ...trend });
      return { ok: true, ...result, ...trend };
    },
  ),
);
