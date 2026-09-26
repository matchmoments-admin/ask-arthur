/**
 * The readiness scorecard's I/O half (#1237). Every read goes to an EXISTING
 * source — this file adds no measurement, only the reads that feed
 * readiness.ts's pure scoring:
 *
 *   precision / fp_share / lane_health  clone_watch_readiness_inputs (v335)
 *   fn_rate                             clone_watch_not_a_clone_audit_summary (v330)
 *   report_diff                         clone_watch_monthly_brand_stats (frozen)
 *                                       vs loadCardInputs + buildTrendRows (live)
 *   takedown                            clone_watch_takedown_stats (v329)
 *   stock                               clone_liveness_runs (v325)
 *
 * Every read DEGRADES to null ("not measured") rather than throwing: a lost
 * input makes its component "insufficient", which makes the month NOT ready —
 * the safe direction for a gate in front of brand contact.
 */

import { createServiceClient } from "@askarthur/supabase/server";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { logger } from "@askarthur/utils/logger";
import { monthWindow } from "@/lib/clone-watch/month-window";
import { readMonthFrozenAt } from "@/lib/clone-watch/monthly-brand-store";
import { loadCardInputs } from "@/lib/clone-watch/report-card-data";
import { buildTrendRows } from "@/lib/clone-watch/report-card";
import {
  diffBrandClones,
  evaluateReadinessGate,
  requiredMonths,
  scoreReadiness,
  sumAuditCohorts,
  toReadinessRow,
  READINESS_REQUIRED_MONTHS,
  type NotACloneInputs,
  type ReadinessGate,
  type ReadinessInputs,
  type ReportDiffInputs,
  type Scorecard,
  type StockInputs,
  type TakedownRow,
  type TriageAndLaneInputs,
} from "@/lib/clone-watch/readiness";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

const warn = (what: string, err: unknown) =>
  logger.warn(`clone-watch readiness: ${what} unreadable`, {
    error: err instanceof Error ? err.message : String(err),
  });

async function readSqlInputs(
  sb: ServiceClient,
  startIso: string,
  endIso: string,
): Promise<TriageAndLaneInputs | null> {
  try {
    const { data, error } = await sb.rpc("clone_watch_readiness_inputs", {
      p_start: startIso,
      p_end: endIso,
    });
    if (error) throw new Error(error.message);
    if (!data || typeof data !== "object") throw new Error("empty result");
    return data as TriageAndLaneInputs;
  } catch (err) {
    warn("triage/lane inputs", err);
    return null;
  }
}

/**
 * Samples DRAWN in the month, summed (the RPC is cohort-grained; a cohort's
 * samples are drawn in one call, so first_sampled_at is its draw time).
 *
 * Windowed by draw, not by verdict (#1260 review L3): the draw is fixed at
 * sampling, so a month's figure never moves once its samples are scanned, and
 * a sample counts once in the month that drew it. The cost: a sample drawn
 * late in the month may still be unscanned on the 1st (it is re-offered every
 * 168 h) — it counts in `sampled`, not `scanned`, so the month reads
 * insufficient rather than a rate over the early part only.
 */
async function readNotAClone(
  sb: ServiceClient,
  startIso: string,
  endIso: string,
): Promise<NotACloneInputs | null> {
  try {
    const { data, error } = await sb.rpc("clone_watch_not_a_clone_audit_summary", {
      p_since: startIso,
    });
    if (error) throw new Error(error.message);
    return sumAuditCohorts((data ?? []) as Array<Record<string, unknown>>, startIso, endIso);
  } catch (err) {
    warn("not-a-clone audit", err);
    return null;
  }
}

async function readReportDiff(
  sb: ServiceClient,
  periodYm: string,
  periodMonth: string,
): Promise<{ report: ReportDiffInputs | null; unavailable?: string }> {
  try {
    const frozenAt = await readMonthFrozenAt(sb, periodMonth);
    if (!frozenAt) {
      return { report: null, unavailable: "The month's store is not frozen yet — nothing published to check." };
    }
    const frozen = await fetchAllRows<{ brand: string; clones: number }>((from, to) =>
      sb
        .from("clone_watch_monthly_brand_stats")
        .select("brand, clones")
        .eq("period_month", periodMonth)
        .order("brand", { ascending: true })
        .range(from, to),
    );
    if (frozen.error) throw new Error(frozen.error.message);
    // The SAME fold the store writer used (clone-watch-report-summary):
    // loadCardInputs → buildTrendRows → aggregateClonesByDomain.
    const inputs = await loadCardInputs(periodYm);
    const live = buildTrendRows(inputs).brandRows;
    return { report: diffBrandClones(frozen.rows, live) };
  } catch (err) {
    warn("report diff", err);
    return { report: null, unavailable: "The frozen store or the live recount could not be read." };
  }
}

async function readTakedown(
  sb: ServiceClient,
  days: number,
): Promise<TakedownRow | null> {
  try {
    const { data, error } = await sb.rpc("clone_watch_takedown_stats", { p_days: days });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return row && typeof row === "object" ? (row as TakedownRow) : null;
  } catch (err) {
    warn("takedown stats", err);
    return null;
  }
}

async function readStock(
  sb: ServiceClient,
  periodMonth: string,
): Promise<StockInputs | null> {
  try {
    const { data, error } = await sb
      .from("clone_liveness_runs")
      .select("stock, unverified, completed_at")
      .eq("period_month", periodMonth)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const r = data as { stock: number | null; unverified: number | null; completed_at: string | null };
    return {
      stock: Number(r.stock ?? 0),
      unverified: Number(r.unverified ?? 0),
      completedAt: r.completed_at,
    };
  } catch (err) {
    warn("month-end stock", err);
    return null;
  }
}

/** Every input for one month ("YYYY-MM"). Never throws. */
export async function loadReadinessInputs(
  sb: ServiceClient,
  periodYm: string,
): Promise<ReadinessInputs> {
  const w = monthWindow(periodYm);
  const days = Math.round((Date.parse(w.endIso) - Date.parse(w.startIso)) / 86_400_000);
  const [sql, notAClone, report, takedown, stock] = await Promise.all([
    readSqlInputs(sb, w.startIso, w.endIso),
    readNotAClone(sb, w.startIso, w.endIso),
    readReportDiff(sb, periodYm, w.periodMonth),
    // Trailing window ending NOW: computed on the 1st, it covers the month
    // just closed. A later on-demand recompute of an old month is therefore
    // a check of the metric's validity today, not of that month's figures.
    readTakedown(sb, days),
    readStock(sb, w.periodMonth),
  ]);
  return {
    periodMonth: w.periodMonth,
    sql,
    notAClone,
    report: report.report,
    reportUnavailable: report.unavailable,
    takedown,
    stock,
  };
}

export async function computeReadiness(
  sb: ServiceClient,
  periodYm: string,
): Promise<Scorecard> {
  return scoreReadiness(await loadReadinessInputs(sb, periodYm));
}

/** Upsert the month's row. Throws on a failed write (the caller logs it). */
export async function writeReadiness(
  sb: ServiceClient,
  card: Scorecard,
): Promise<void> {
  const row = { ...toReadinessRow(card), computed_at: new Date().toISOString() };
  const { error } = await sb
    .from("clone_watch_readiness")
    .upsert(row, { onConflict: "period_month" });
  if (error) throw new Error(`clone_watch_readiness upsert: ${error.message}`);
}

/**
 * Wall-clock bound on the monthly compute (#1260 review L2). A compute that
 * outruns it returns a degraded result instead of running into the platform's
 * own timeout, which would fail the step with nothing caught. Restated in
 * clone-watch-report-summary's finish-budget header (the budget test sums every
 * `*_WALL_CLOCK_MS` in a function's source) — change both together.
 */
export const READINESS_WALL_CLOCK_MS = 90_000;

export type ReadinessRunResult =
  | { ready: boolean; statuses: Record<string, string> }
  | { errored: "supabase_unavailable" | "timeout" | "compute_or_write_failed" | "step_failed" };

/**
 * The monthly step body: compute, write, log. NEVER throws — every failure is
 * a degraded result (no row → the gate reads NOT ready). The write happens
 * only when the compute beat the clock, so a late compute cannot land a row
 * after the step has already reported a timeout.
 */
export async function computeAndRecordReadiness(
  periodYm: string,
  deps: {
    client?: () => ServiceClient | null;
    compute?: (sb: ServiceClient, ym: string) => Promise<Scorecard>;
    write?: (sb: ServiceClient, card: Scorecard) => Promise<void>;
    wallClockMs?: number;
  } = {},
): Promise<ReadinessRunResult> {
  const compute = deps.compute ?? computeReadiness;
  const write = deps.write ?? writeReadiness;
  const wallClockMs = deps.wallClockMs ?? READINESS_WALL_CLOCK_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sb = deps.client ? deps.client() : createServiceClient();
    if (!sb) return { errored: "supabase_unavailable" };
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), wallClockMs);
    });
    const card = await Promise.race([compute(sb, periodYm), timeout]);
    if (card === "timeout") {
      logger.error("clone-watch readiness: compute exceeded its wall clock", {
        period: periodYm,
        wallClockMs,
        consequence: "no clone_watch_readiness row → brand sends stay in shadow",
      });
      return { errored: "timeout" };
    }
    await write(sb, card);
    const statuses = Object.fromEntries(card.components.map((c) => [c.key, c.status]));
    // Monthly and decisive for brand contact — always-ship (warn).
    logger.warn("clone-watch readiness: scorecard written", {
      period: card.periodMonth,
      ready: card.ready,
      ...statuses,
    });
    return { ready: card.ready, statuses };
  } catch (err) {
    logger.error("clone-watch readiness: compute or write failed", {
      period: periodYm,
      error: err instanceof Error ? err.message : String(err),
      consequence: "no clone_watch_readiness row → brand sends stay in shadow",
    });
    return { errored: "compute_or_write_failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The send gate's read. An error (or a thrown client) reads as "unreadable",
 * which evaluateReadinessGate turns into NOT ready — never fail open.
 */
export async function readReadinessGate(
  sb: ServiceClient | null,
  now: Date = new Date(),
  required = READINESS_REQUIRED_MONTHS,
): Promise<ReadinessGate> {
  let rows: Array<Record<string, unknown>> | null = null;
  if (sb) {
    try {
      const { data, error } = await sb
        .from("clone_watch_readiness")
        .select("period_month, ready")
        .in("period_month", requiredMonths(now, Math.max(required, 1)));
      if (!error && Array.isArray(data)) rows = data;
      else if (error) warn("gate", error.message);
    } catch (err) {
      warn("gate", err);
    }
  }
  return evaluateReadinessGate(rows, now, required);
}

/** The last `n` stored scorecards, newest first (admin page). Null = unreadable. */
export async function readRecentReadiness(
  sb: ServiceClient,
  n = 3,
): Promise<Array<Record<string, unknown>> | null> {
  const { data, error } = await sb
    .from("clone_watch_readiness")
    .select("*")
    .order("period_month", { ascending: false })
    .limit(n);
  if (error) return null;
  return (data ?? []) as Array<Record<string, unknown>>;
}
