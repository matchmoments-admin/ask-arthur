import { inngest } from "@askarthur/scam-engine/inngest/client";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { createServiceClient } from "@askarthur/supabase/server";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { logger } from "@askarthur/utils/logger";
import { CLONE_COHORT_SOURCE } from "@/lib/clone-watch/clone-cohort";
import { probeStockDns } from "@/lib/clone-watch/liveness";
import {
  probeChunk,
  selectActiveStock,
  STOCK_ROW_SELECT,
  unprobedSnapshot,
  type SnapshotInsert,
  type StockCandidate,
  type StockRow,
} from "@/lib/clone-watch/month-end-stock";
import { monthWindow, priorMonthStart } from "@/lib/clone-watch/month-window";
import { laneCrons } from "@/lib/laneHealth";

const MANUAL_TRIGGER_EVENT = "clone-watch/month-end-liveness.manual-trigger.v1";

// Ids per probe step. ~3k active stock (Sep 2026), growing ~850/month and
// nothing leaves "declined" → ~11 chunks today.
const CHUNK_SIZE = 300;
// Hard cap on probe steps per run: 40 × 300 = 12,000 ids, ~10 months of
// headroom at today's growth. Anything the cap leaves unreached is still
// written — as `unverified` (reason not_probed) — so the snapshot always
// covers the whole stock, and the summary persists NULL (not 0) for any brand
// whose rows are mostly unverified.
const MAX_CHUNKS = 40;
// Above this share of unverified rows the run warns always-ship: the resolver
// had a bad night and many brands' stock will persist NULL. Normal is ~5%.
const UNVERIFIED_WARN_SHARE = 0.2;
// In-step budget per chunk. A healthy DNS answer is ~ms; a slow one caps at
// 4 s per query (3 queries), so 300 ids at width 16 is ~2 s typical and ~225 s
// if every name timed out — the budget stops picking new ids at 60 s and the
// tail carries to the next chunk.
const PROBE_WALL_CLOCK_MS = 60_000;
// Rows per snapshot upsert / id-list read.
const WRITE_BATCH = 200;
// Load ceiling (all NRD alerts ever, before filtering) — throws, never truncates.
const LOAD_MAX_ROWS = 50_000;

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

async function readStockRows(sb: ServiceClient, ids: readonly number[]): Promise<StockRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from("shopfront_clone_alerts")
    .select(STOCK_ROW_SELECT)
    .in("id", ids as number[]);
  if (error) throw new Error(`stock row read failed: ${error.message}`);
  return (data ?? []) as unknown as StockRow[];
}

async function upsertSnapshots(sb: ServiceClient, rows: SnapshotInsert[]): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const { error } = await sb
      .from("clone_liveness_snapshots")
      .upsert(rows.slice(i, i + WRITE_BATCH), { onConflict: "period_month,alert_id" });
    if (error) throw new Error(`snapshot upsert failed: ${error.message}`);
  }
}

/** Upsert the month's completion record (clone_liveness_runs). */
async function recordRun(
  periodMonth: string,
  r: { stock: number; written: number; unverified: number; not_probed: number },
): Promise<void> {
  const sb = createServiceClient();
  if (!sb) throw new Error("service client unavailable");
  const { error } = await sb
    .from("clone_liveness_runs")
    .upsert(
      { period_month: periodMonth, ...r, completed_at: new Date().toISOString() },
      { onConflict: "period_month" },
    );
  if (error) throw new Error(`run record write failed: ${error.message}`);
}

/**
 * clone-watch-month-end-liveness — the month-end STOCK snapshot (v325, #1225).
 *
 * Runs 01:00 UTC on the 1st, ten hours before clone-watch-report-summary
 * reads it into `clone_watch_monthly_brand_stats.active_stock_eom`. For every
 * active-stock lookalike (source nrd, not taken_down / dormant / fp, one per
 * domain — `selectActiveStock`) it asks DNS (A, AAAA when A is empty, NS) and
 * records one `clone_liveness_snapshots` row with the `stockStatus` verdict
 * (clone-metrics.ts). DNS only: no HTTP fetch, no paid call, $0.
 *
 * Why a snapshot and not the summary's own probe: the summary is one step on
 * a 6m budget and ~3k DNS lookups do not belong inside it. A missing snapshot
 * is honest downstream — the summary persists active_stock_eom NULL, never 0.
 *
 * Also re-opens v326 dead-dormant rows (#1240): urlscan refused them as
 * unresolvable eight times running and the recheck worklist stopped offering
 * them. If month-end DNS now resolves one to a host,
 * `reset_clone_alert_dead_dormancy` zeroes its streak (the RPC re-checks the
 * predicate itself) and the Outcome Row counts it as `dormancy_reset`.
 *
 * SHAPE. `load-stock` returns ids only (a few KB); each `probe-<n>` step reads
 * its slice, probes under an in-step budget, upserts, and returns how many ids
 * it handled — a budget-cut chunk's tail starts the next chunk, so nothing is
 * dropped. The offset is carried through memoised step results, so it is
 * replay-safe (no wall-clock accumulator at handler level). After MAX_CHUNKS,
 * `mark-unprobed` writes the remainder as unverified.
 *
 * COMPLETION RECORD. `load-stock` first deletes the period's run record and
 * snapshot rows; `record-run` writes clone_liveness_runs LAST, after every
 * snapshot row. The summary trusts the snapshot only when that record exists
 * and the row count matches it — so a run that died mid-walk (a chunk out of
 * retries, a silent finish-timeout cancel) reads as "not measured" (NULL),
 * never as a partial snapshot folded into fabricated zeros.
 *
 * inngest-finish-budget: 45 boundaries — compute-period + load-stock + ≤40 probe chunks + mark-unprobed + record-run + log-outcome
 * Floor = 45 × 30 s + 60 s (PROBE_WALL_CLOCK_MS) + 60 s = 1,470 s → 40m, which
 * also leaves room for chunks that run to their budget. Monthly, one run.
 *
 * Manual trigger: { periodMonth?: "YYYY-MM" } — re-snapshots the month JUST
 * CLOSED only (anything else throws): DNS answers today, so a snapshot
 * labelled with an older month would be backdated fiction. The rerun
 * replaces the month's rows wholesale. A re-snapshot after the month's summary
 * ran does not change the frozen store (republish does).
 */
export const cloneWatchMonthEndLiveness = inngest.createFunction(
  {
    id: "clone-watch-month-end-liveness",
    name: "Clone-Watch: month-end liveness snapshot (active stock)",
    retries: 2,
    // One at a time: a manual fire during the scheduled run would double the
    // DNS load and race the same (period, alert) upserts.
    concurrency: { limit: 1 },
    timeouts: { finish: "40m" },
  },
  [
    // 1st of month, 01:00 UTC — before the 11:00 summary reads it.
    ...laneCrons("clone-watch-month-end-liveness"),
    { event: MANUAL_TRIGGER_EVENT }, // { periodMonth?: "YYYY-MM" }
  ],
  withAxiomLogging(
    { fnId: "clone-watch-month-end-liveness" },
    async ({ event, step }) => {
      // A cron tick carries a payload ({ cron }) — decide "manual" by NAME.
      const manual =
        event?.name === MANUAL_TRIGGER_EVENT
          ? ((event?.data ?? {}) as { periodMonth?: string })
          : {};

      const window = await step.run("compute-period", async () => {
        const closed = priorMonthStart(new Date()).toISOString().slice(0, 7);
        const ym = manual.periodMonth ? manual.periodMonth.slice(0, 7) : closed;
        if (ym !== closed) {
          throw new Error(
            `month-end liveness probes today's DNS, so it can only snapshot the month just closed (${closed}), not ${ym}`,
          );
        }
        return monthWindow(ym);
      });

      const ids = await step.run("load-stock", async () => {
        const sb = createServiceClient();
        if (!sb) throw new Error("service client unavailable");
        const { rows, truncated, error } = await fetchAllRows<StockCandidate>(
          (from, to) =>
            sb
              .from("shopfront_clone_alerts")
              .select("id, candidate_domain, inferred_target_domain, lifecycle_state, triage_status")
              .eq("source", CLONE_COHORT_SOURCE)
              .not("inferred_target_domain", "is", null)
              .lt("first_seen_at", window.endIso)
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: StockCandidate[] | null;
              error: { message: string } | null;
            }>,
          { maxRows: LOAD_MAX_ROWS },
        );
        if (error) throw new Error(`stock load failed: ${error.message}`);
        if (truncated) throw new Error(`stock load exceeds ${LOAD_MAX_ROWS} rows`);
        // Start clean: completion record first (so a crash from here on
        // leaves "not measured"), then the rows — a rerun must not keep rows
        // for alerts that have since left the stock.
        const delRun = await sb
          .from("clone_liveness_runs")
          .delete()
          .eq("period_month", window.periodMonth);
        if (delRun.error) throw new Error(`run record reset failed: ${delRun.error.message}`);
        const delRows = await sb
          .from("clone_liveness_snapshots")
          .delete()
          .eq("period_month", window.periodMonth);
        if (delRows.error) throw new Error(`snapshot reset failed: ${delRows.error.message}`);
        return selectActiveStock(rows);
      });

      if (ids.length === 0) {
        await step.run("record-run", () =>
          recordRun(window.periodMonth, { stock: 0, written: 0, unverified: 0, not_probed: 0 }),
        );
        await step.run("log-outcome", () =>
          recordLaneOutcome("clone-watch-month-end-liveness", 0, {
            reason: "no_stock",
            stock: 0,
            probed: 0,
            unverified: 0,
            not_probed: 0,
            period: window.periodMonth,
            dormancy_reset: 0,
          }),
        );
        return { ok: true, period: window.periodMonth, stock: 0 };
      }

      let offset = 0;
      let written = 0;
      let dormancyReset = 0;
      const byStatus: Record<string, number> = {};
      for (let c = 0; c < MAX_CHUNKS && offset < ids.length; c++) {
        const slice = ids.slice(offset, offset + CHUNK_SIZE);
        const chunk = await budgetedStep(
          step,
          `probe-${c}`,
          PROBE_WALL_CLOCK_MS,
          async (budget) => {
            const sb = createServiceClient();
            if (!sb) throw new Error("service client unavailable");
            const rows = await readStockRows(sb, slice);
            const res = await probeChunk({
              ids: slice,
              rows,
              periodMonth: window.periodMonth,
              probe: probeStockDns,
              expired: () => budget.expired(),
            });
            await upsertSnapshots(sb, res.snapshots);

            let reset = 0;
            if (res.dormantResolving.length > 0) {
              const { data, error } = await sb.rpc("reset_clone_alert_dead_dormancy", {
                p_alert_ids: res.dormantResolving,
              });
              if (error) {
                // Never fail the snapshot for the reset: the next month-end
                // pass asks again.
                logger.warn("clone-watch month-end liveness: dormancy reset failed", {
                  error: error.message,
                  ids: res.dormantResolving.length,
                });
              } else {
                reset = ((data ?? []) as number[]).length;
              }
            }

            const counts: Record<string, number> = {};
            for (const s of res.snapshots) counts[s.status] = (counts[s.status] ?? 0) + 1;
            return { handled: res.handled, written: res.snapshots.length, counts, reset };
          },
        );
        // A chunk that handled nothing cannot progress (its budget was spent
        // before the first probe); stop and let mark-unprobed write the rest
        // rather than spin on the same offset.
        if (chunk.handled === 0) break;
        offset += chunk.handled;
        written += chunk.written;
        dormancyReset += chunk.reset;
        for (const [k, v] of Object.entries(chunk.counts)) byStatus[k] = (byStatus[k] ?? 0) + v;
      }

      let notProbed = 0;
      if (offset < ids.length) {
        const rest = ids.slice(offset);
        notProbed = await step.run("mark-unprobed", async () => {
          const sb = createServiceClient();
          if (!sb) throw new Error("service client unavailable");
          const checkedAt = new Date().toISOString();
          let written = 0;
          for (let i = 0; i < rest.length; i += WRITE_BATCH) {
            const rows = await readStockRows(sb, rest.slice(i, i + WRITE_BATCH));
            const snaps = rows.map((r) => unprobedSnapshot(r, window.periodMonth, checkedAt));
            await upsertSnapshots(sb, snaps);
            written += snaps.length;
          }
          return written;
        });
        // Rare and important: the stock figure for this month is an undercount.
        logger.warn("clone-watch month-end liveness: stock not fully probed", {
          period: window.periodMonth,
          stock: ids.length,
          notProbed,
        });
      }

      // `unverified` = resolver proved nothing + never reached. `probed`
      // counts only real verdicts, so a resolver-wide failure reads as
      // probed 0 (silentZero pages) — not as 3k rows "checked".
      const unverified = (byStatus.unverified ?? 0) + notProbed;
      const probed = written - (byStatus.unverified ?? 0);
      if (ids.length > 0 && unverified > ids.length * UNVERIFIED_WARN_SHARE) {
        logger.warn("clone-watch month-end liveness: resolver proved little", {
          period: window.periodMonth,
          stock: ids.length,
          unverified,
          consequence: "brands with >20% unverified rows persist active_stock_eom NULL",
        });
      }

      // LAST write: the completion record the summary checks before trusting
      // a single snapshot row.
      await step.run("record-run", () =>
        recordRun(window.periodMonth, {
          stock: ids.length,
          written: written + notProbed,
          unverified,
          not_probed: notProbed,
        }),
      );

      await step.run("log-outcome", () =>
        recordLaneOutcome("clone-watch-month-end-liveness", ids.length, {
          stock: ids.length,
          probed,
          unverified,
          not_probed: notProbed,
          period: window.periodMonth,
          by_status: byStatus,
          dormancy_reset: dormancyReset,
        }),
      );

      return {
        ok: true,
        period: window.periodMonth,
        stock: ids.length,
        probed,
        unverified,
        notProbed,
        byStatus,
        dormancyReset,
      };
    },
  ),
);
