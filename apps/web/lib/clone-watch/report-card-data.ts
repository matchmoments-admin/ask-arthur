import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { AU_BRAND_WATCHLIST } from "@askarthur/shopfront-glue";
import {
  applyCohortRules,
  CLONE_COHORT_SELECT,
  CLONE_COHORT_SOURCE,
  type CloneAlertRow,
} from "@/lib/clone-watch/clone-cohort";
import { monthWindow, priorWindow } from "@/lib/clone-watch/month-window";
import type { BrandCoverage } from "@/lib/clone-watch/brand-coverage";
import {
  buildReportCard,
  buildTrendRows,
  type CardInputs,
  type CloneWatchReportCard,
  type CloneWatchTrendRows,
} from "@/lib/clone-watch/report-card";

/**
 * The report card's I/O half — four reads, zero computation.
 *
 * The fold lives in report-card.ts. This file exists only to turn a month into
 * the rows that fold needs, which is what makes the card testable from fixtures
 * and lets one edition be computed ONCE and passed to the slide export, the
 * caption and the publish write-back instead of each recomputing it from a
 * table the reconciler mutates daily.
 *
 * Pure read path — no writes, no Inngest, no cron. Safe to run any number of
 * times.
 */

// A REACHABLE ceiling. The previous value was 5000, passed to `.limit()` and
// then guarded with `raw.length === FETCH_LIMIT` — but PostgREST caps every
// response at 1000 rows, so the guard compared against a number the server can
// never return and never fired. July 2026 published "1000 detected" when the
// truth was 1064. We now paginate, and this bound is checked against the paged
// total, which CAN reach it.
//
// The ceiling is deliberately a CALLER policy, not a cohort one: the
// brand-stewardship digest uses 3,000 and the internal digest 5,000, and each is
// sized for what that surface does with the rows.
const FETCH_LIMIT = 20_000;

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

/** One calendar month of cohort rows. */
async function fetchMonth(
  sb: ServiceClient,
  startIso: string,
  endIso: string,
  periodMonth: string,
): Promise<CloneAlertRow[]> {
  // `.order("id")` is load-bearing, not cosmetic: a .range() walk over an
  // unordered query can skip and repeat rows between pages.
  const { rows: raw, truncated, error } = await fetchAllRows<CloneAlertRow>(
    (from, to) =>
      sb
        .from("shopfront_clone_alerts")
        // The cohort's own SELECT and source (clone-cohort.ts), shared with the
        // brand-stewardship report and the internal digest, so all three
        // reconcile by construction rather than by three files agreeing. It was
        // three inline lists, and the drift already cost `clone_tactic` once —
        // the column simply arrived undefined, which reads as thin classifier
        // coverage rather than as a missing column.
        .select(CLONE_COHORT_SELECT)
        .eq("source", CLONE_COHORT_SOURCE)
        .gte("first_seen_at", startIso)
        .lt("first_seen_at", endIso)
        .not("inferred_target_domain", "is", null)
        .or("triage_status.is.null,triage_status.neq.fp")
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: CloneAlertRow[] | null;
        error: { message: string } | null;
      }>,
    { maxRows: FETCH_LIMIT },
  );

  if (error) throw new Error(`report-card fetch failed: ${error.message}`);

  // Warn on the RAW count (pre-FP-filter) so an FP row dropped after the fetch
  // can't mask a truncated result.
  if (truncated) {
    logger.warn("report-card: clone fetch hit LIMIT", {
      limit: FETCH_LIMIT,
      period: periodMonth,
    });
  }
  return applyCohortRules(raw);
}

/**
 * The four reads, in one place.
 *
 * Call this ONCE per edition and fold it as many times as you like — that is
 * the whole point. `getCloneWatchReportCard` and `getCloneWatchTrendRows` below
 * are thin conveniences over it; the monthly cron should use this directly, as
 * it previously fetched the current month twice (once per entry point).
 */
export async function loadCardInputs(month?: string): Promise<CardInputs> {
  const window = monthWindow(month);
  const prevWin = priorWindow(window.startIso);
  const sb = createServiceClient();
  if (!sb) throw new Error("service client unavailable");

  const rows = await fetchMonth(
    sb,
    window.startIso,
    window.endIso,
    window.periodMonth,
  );
  const priorRows = await fetchMonth(
    sb,
    prevWin.startIso,
    prevWin.endIso,
    prevWin.periodMonth,
  );

  // What did LAST month's edition actually spotlight? Read the persisted value
  // so the no-repeat rule works off published history rather than a guess.
  // Editions predating the `spotlight` column fall back to `super_fund`, which
  // IS what those months showed on slide 3 — so no backfill is needed.
  let priorSpotlightBrand: string | null = null;
  try {
    const { data: priorRow } = await sb
      .from("clone_watch_report_summary")
      .select("spotlight, super_fund")
      .eq("period_month", prevWin.periodMonth)
      .maybeSingle();
    const sp = priorRow?.spotlight as { brand?: string } | null | undefined;
    const sf = priorRow?.super_fund as { brand?: string } | null | undefined;
    priorSpotlightBrand = sp?.brand ?? sf?.brand ?? null;
  } catch {
    // No prior row (or the column is missing on an older deploy) — the ladder
    // simply runs without the no-repeat constraint this month.
  }

  // NULL means the read FAILED. That is not the same as an empty table, and
  // collapsing the two is how a degraded read quietly becomes "no exclusions".
  let coverage: BrandCoverage[] | null = null;
  {
    const { data, error } = await sb
      .from("brand_coverage_history")
      .select("brand, brand_normalized, brand_domain, covered_from, covered_to");
    if (error) {
      logger.warn("report-card: brand coverage read failed", {
        error: error.message,
      });
    } else {
      coverage = (data ?? []).map((r) => {
        const row = r as {
          brand_normalized: string;
          brand_domain: string;
          covered_from: string;
          covered_to: string | null;
        };
        return {
          brandDomain: row.brand_domain,
          brandNormalized: row.brand_normalized,
          coveredFrom: row.covered_from,
          coveredTo: row.covered_to,
        };
      });
      if (coverage.length === 0) {
        // An EMPTY table is not an error, so nothing above logs — yet it
        // suppresses every trend claim exactly as a failed read does, and
        // silently: `buildTrendDisclosure` early-returns "" when nothing is
        // claimable, so the caveat that would explain the absence is the very
        // thing that goes missing. Say so, or a card built before
        // backfill-brand-coverage.ts has run reads as a quiet month.
        logger.warn("report-card: brand_coverage_history is EMPTY", {
          period: window.periodMonth,
          consequence:
            "all trend claims suppressed; run backfill-brand-coverage.ts",
        });
      }
    }
  }

  return {
    window,
    priorWindow: prevWin,
    rows,
    priorRows,
    coverage,
    priorSpotlightBrand,
    watchlistFallbackSize: AU_BRAND_WATCHLIST.length,
  };
}

/** Convenience: load + fold. Prefer `loadCardInputs` when you need both folds. */
export async function getCloneWatchReportCard(
  month?: string,
): Promise<CloneWatchReportCard> {
  return buildReportCard(await loadCardInputs(month));
}

/** Convenience: load + fold the full per-brand / per-registrar trend rows. */
export async function getCloneWatchTrendRows(
  month?: string,
): Promise<CloneWatchTrendRows> {
  const inputs = await loadCardInputs(month);
  return buildTrendRows(inputs);
}

// The card's types live with the fold that produces them. Re-exported because
// every consumer (the admin page, the caption, the summary writer, the export
// scripts and their tests) imports them from here.
export type {
  BrandTrendGate,
  BrandTrendRow,
  CardInputs,
  CloneWatchReportCard,
  CloneWatchTrendRows,
  MonthOverMonth,
  RankedBrand,
  RegistrarTrendRow,
  Spotlight,
  SpotlightKind,
  SuperFundSpotlight,
} from "@/lib/clone-watch/report-card";
