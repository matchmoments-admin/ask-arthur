/**
 * Month Facts — "what are brand X's clone numbers for month M", answered once.
 *
 * THE RULE (#1296, map #1294):
 *
 *   - A PUBLISHED month (frozen in the Monthly Brand Store, v319) is served
 *     from the store and nothing else. Its numbers are the ones the brand's
 *     report, the monthly edition and the stewardship ledger printed. A live
 *     recount of a closed month drifts as alerts move on — measured
 *     2026-10-13: August published 45 weaponised; recounted today it is 25,
 *     because 20 have since been taken down or gone dormant. Both are "true",
 *     and printing the second next to the first is the +62% Kmart class of
 *     defect.
 *   - The OPEN month (now before the month's end, not yet frozen) is a
 *     PROVISIONAL live recount over the Brand Cohort (v342), folded by the
 *     same `aggregateClonesByDomain` the store's producer uses — so the
 *     provisional figure is the one the store will publish if nothing moves.
 *   - A CLOSED month that is not frozen (the hours between month end and the
 *     summary run on the 1st, or a month the store never published) is
 *     UNPUBLISHED: no number. It is never filled in with a recount, because
 *     that recount would become a second published answer for the month.
 *
 * Interface: `readBrandMonthFacts` (I/O) and `monthBasis` (the rule, pure).
 * Callers branch on `basis` to label the figure ("September (published)" vs
 * "October so far"); they never choose a source themselves.
 *
 * Deletion test: without this Module each surface that wants "this brand's
 * month" picks between the store and a recount itself — which is exactly how
 * the report card's MoM fallback, the pilot email's rolling window and the
 * worklist's all-time count ended up as three different numbers.
 */
import type { createServiceClient } from "@askarthur/supabase/server";
import {
  applyCohortRules,
  CLONE_COHORT_RELATION,
  CLONE_COHORT_SELECT,
  periodCountsTargetingEvents,
  type CloneAlertRow,
} from "@/lib/clone-watch/clone-cohort";
import { aggregateClonesByDomain } from "@/lib/clone-watch/clone-metrics";
import { monthWindow } from "@/lib/clone-watch/month-window";
import { readMonthFrozenAt } from "@/lib/clone-watch/monthly-brand-store";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

export type MonthBasis = "published" | "provisional" | "unpublished";

/** The counts every surface prints for a brand-month. Store column names in
 *  comments; the provisional fold fills the same fields the same way. */
export interface MonthCounts {
  /** Distinct lookalike domains (store `clones`). */
  clones: number;
  /** Bulk registrations counted once (store `targeting_events`); null for a
   *  month ingested before matcher v5 — not measured in that unit, NOT 0. */
  targetingEvents: number | null;
  /** store `reported_to_netcraft` */
  reportedToNetcraft: number;
  /** store `weaponised` (cohort and state at publication) */
  weaponised: number;
  /** store `taken_down` (cohort and state at publication) */
  takenDown: number;
}

export interface BrandMonthFacts {
  brand: string;
  /** "YYYY-MM-01" */
  periodMonth: string;
  /** "September 2026" */
  label: string;
  basis: MonthBasis;
  /** When the month was published; null unless basis is "published". */
  frozenAt: string | null;
  /**
   * null when the month is unpublished, OR published without a row for this
   * brand (the store writes a zero row for every brand it WATCHED, so an absent
   * row means not watched that month — never read it as 0).
   */
  counts: MonthCounts | null;
}

/** The open/closed rule, pure. A frozen month is published even if an
 *  operator froze it before its end. */
export function monthBasis(
  periodMonth: string,
  frozenAt: string | null,
  now: Date,
): MonthBasis {
  if (frozenAt) return "published";
  return now.getTime() < Date.parse(monthWindow(periodMonth).endIso)
    ? "provisional"
    : "unpublished";
}

/** A store row → MonthCounts. Pure. */
export function countsFromStoreRow(row: {
  clones: number | null;
  targeting_events: number | null;
  reported_to_netcraft: number | null;
  weaponised: number | null;
  taken_down: number | null;
}): MonthCounts {
  return {
    clones: Number(row.clones ?? 0),
    targetingEvents: row.targeting_events == null ? null : Number(row.targeting_events),
    reportedToNetcraft: Number(row.reported_to_netcraft ?? 0),
    weaponised: Number(row.weaponised ?? 0),
    takenDown: Number(row.taken_down ?? 0),
  };
}

/**
 * Cohort rows for one brand-month → MonthCounts, through the store producer's
 * own fold (aggregateClonesByDomain), so a provisional figure and the figure
 * later published are computed identically. Pure.
 */
export function countsFromCohortRows(
  rows: CloneAlertRow[],
  brand: string,
  periodMonth: string,
): MonthCounts {
  const m = aggregateClonesByDomain(applyCohortRules(rows)).get(brand);
  const countsEvents = periodCountsTargetingEvents(periodMonth);
  return {
    clones: m?.detected ?? 0,
    targetingEvents: countsEvents ? (m?.targetingEvents ?? 0) : null,
    reportedToNetcraft: m?.netcraftReported ?? 0,
    weaponised: m?.weaponised ?? 0,
    takenDown: m?.takenDown ?? 0,
  };
}

/** One brand's alerts in a month is small (observed max ~330); a reachable
 *  ceiling that fails loudly rather than under-counting. */
const PROVISIONAL_ROW_CAP = 1000;

/**
 * Brand X's facts for month M. Throws on a read failure — a caller that can
 * render without the figure catches and omits it; it must never substitute a
 * recount for a published month.
 */
export async function readBrandMonthFacts(
  sb: ServiceClient,
  brandDomain: string,
  month: string, // "YYYY-MM" or "YYYY-MM-DD"
  now: Date = new Date(),
): Promise<BrandMonthFacts> {
  const brand = brandDomain.trim().toLowerCase();
  const window = monthWindow(month);
  const frozenAt = await readMonthFrozenAt(sb, window.periodMonth);
  const basis = monthBasis(window.periodMonth, frozenAt, now);
  const base = { brand, periodMonth: window.periodMonth, label: window.label, basis, frozenAt };

  if (basis === "unpublished") return { ...base, counts: null };

  if (basis === "published") {
    const { data, error } = await sb
      .from("clone_watch_monthly_brand_stats")
      .select("clones, targeting_events, reported_to_netcraft, weaponised, taken_down")
      .eq("period_month", window.periodMonth)
      .eq("brand", brand)
      .maybeSingle();
    if (error) throw new Error(`month facts store read failed: ${error.message}`);
    return {
      ...base,
      counts: data ? countsFromStoreRow(data as Parameters<typeof countsFromStoreRow>[0]) : null,
    };
  }

  const { data, error } = await sb
    .from(CLONE_COHORT_RELATION)
    .select(CLONE_COHORT_SELECT)
    .eq("inferred_target_domain", brand)
    .gte("first_seen_at", window.startIso)
    .lt("first_seen_at", window.endIso)
    .order("id", { ascending: true })
    .limit(PROVISIONAL_ROW_CAP);
  if (error) throw new Error(`month facts cohort read failed: ${error.message}`);
  const rows = (data ?? []) as unknown as CloneAlertRow[];
  if (rows.length >= PROVISIONAL_ROW_CAP) {
    throw new Error(`month facts: ${brand} ${window.periodMonth} reached ${PROVISIONAL_ROW_CAP} rows`);
  }
  return { ...base, counts: countsFromCohortRows(rows, brand, window.periodMonth) };
}

/** The month before `now`'s month and `now`'s month — what an outreach
 *  surface shows: the last published figure and the month so far. */
export function lastClosedAndCurrentMonths(now: Date): { lastClosed: string; current: string } {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastClosed = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    lastClosed: lastClosed.toISOString().slice(0, 10),
    current: current.toISOString().slice(0, 10),
  };
}
