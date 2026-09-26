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

import type { createServiceClient } from "@askarthur/supabase/server";
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

/** Cohorts first sampled before the month's end, summed (the RPC is cohort-grained). */
async function readNotAClone(
  sb: ServiceClient,
  endIso: string,
): Promise<NotACloneInputs | null> {
  try {
    const { data, error } = await sb.rpc("clone_watch_not_a_clone_audit_summary", {
      p_since: null,
    });
    if (error) throw new Error(error.message);
    const end = Date.parse(endIso);
    const acc: NotACloneInputs = { sampled: 0, scanned: 0, misses: 0 };
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const first = Date.parse(String(r.first_sampled_at ?? ""));
      if (!Number.isFinite(first) || first >= end) continue;
      acc.sampled += Number(r.sampled ?? 0);
      acc.scanned += Number(r.scanned ?? 0);
      acc.misses += Number(r.misses ?? 0);
    }
    return acc;
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
    readNotAClone(sb, w.endIso),
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
