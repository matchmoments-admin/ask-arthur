import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  aggregateClonesByDomain,
  priorMonthStart,
  type CloneAlertRow,
  type CloneBrandMetrics,
} from "@/app/api/inngest/functions/report-brand-stewardship";
import { buildRegistrarRollup } from "@/app/api/inngest/functions/clone-watch-internal-digest";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";
import { rollupRegistrars } from "@/lib/clone-watch/registrar-canonical";

/**
 * Read-only data layer for the monthly Clone-Watch LinkedIn report card
 * (/admin/report-card). The single source of truth for the public monthly
 * numbers.
 *
 * Deliberately reuses the SAME fetch window + filters + aggregateClonesByDomain
 * aggregator as clone-watch-internal-digest.ts, so this public surface is
 * numerically identical to the internal Telegram digest the operator already
 * trusts (804 detected / 129 brands / 378 unknown-registrar for June 2026).
 * On top of the shared aggregate it adds the three things a PUBLIC card needs:
 *   1. canonicalised, NULL-excluded registrar leaderboard (registrar-canonical.ts)
 *   2. an AU-vs-global brand split for the ranking + footnote
 *   3. the reporting KPIs (detected -> reported -> phishing / parked)
 *
 * Pure read path - one SELECT, no writes, no Inngest, no cron. Callable on
 * demand from the admin route; safe to run any number of times.
 */

/** The digest's window/source/FP filters, verbatim, so counts reconcile. */
const CLONE_SOURCE = "nrd";
const FETCH_LIMIT = 5000;

/**
 * First month with a FULL month of clone-watch coverage. Clone Watch launched
 * 2026-05-24, so May 2026 holds only ~1 week of detections — comparing a full
 * month against that launch stub would overstate month-on-month growth. We only
 * surface a MoM delta when BOTH the report month and its prior month are at or
 * after this threshold, so the first honest comparison is July-2026-vs-June-2026.
 * Editions before that render a "first full month tracked" baseline instead.
 */
const FIRST_FULL_MONTH = "2026-06"; // YYYY-MM

export interface RankedBrand {
  brand: string;
  clones: number;
}

/**
 * AU superannuation-fund brand domains on the clone watchlist. Used to surface
 * the "super fund" editorial angle when a fund ranks among the most-impersonated
 * AU brands (retirement savings as a front-line target). Keyed by full domain
 * so the ambiguous ones ("rest", "aware") can't false-match. Extend as funds are
 * added to the watchlist.
 */
const SUPER_FUND_DOMAINS: ReadonlySet<string> = new Set([
  "hesta.com.au",
  "australiansuper.com",
  "aware.com.au",
  "hostplus.com.au",
  "unisuper.com.au",
  "rest.com.au",
  "cbus.com.au",
  "caresuper.com.au",
  "australianretirementtrust.com.au",
  "spiritsuper.com.au",
  "ngssuper.com.au",
  "brightersuper.com.au",
  "telstrasuper.com.au",
  "visionsuper.com.au",
]);

export interface SuperFundSpotlight {
  /** The impersonated fund's domain, e.g. "hesta.com.au". */
  brand: string;
  clones: number;
  /** 1-based rank among AU brands (1 = most-targeted AU brand). */
  auRank: number;
}

export interface MonthOverMonth {
  /** Whether a fair MoM comparison exists (both months fully tracked). When
   *  false, the card shows a baseline framing rather than a misleading delta. */
  available: boolean;
  /** Human label for the prior month, e.g. "May 2026". */
  priorLabel: string;
  priorTotal: number;
  priorBrands: number;
  /** current.total - prior.total (can be negative). */
  totalDelta: number;
  /** Rounded percentage change vs prior; null when prior total is 0. */
  totalPct: number | null;
  brandsDelta: number;
}

export interface CloneWatchReportCard {
  /** ISO month start, e.g. "2026-06-01". */
  periodMonth: string;
  /** Human label, e.g. "June 2026". */
  periodLabel: string;
  total: number;
  brands: number;
  kpis: {
    reportedToNetcraft: number;
    likelyPhishing: number;
    parkedForSale: number;
    /** Netcraft actioned (lifecycle taken_down) — populated by the PR3.1 reconciler. */
    takenDown: number;
    /** Netcraft declined (still live/parked) — the "unactioned lookalike" headline. */
    declined: number;
    /** We filed a report_issue to force a re-review. */
    escalated: number;
    /** Currently serving active phishing (lifecycle weaponised). */
    weaponised: number;
    /** Weaponised AND previously Netcraft-declined — the only subset for which
     *  the "graded no-threat, later flipped" story is provable (see
     *  lib/clone-watch/outcome-copy.ts honesty rules). */
    weaponisedAfterDecline: number;
    /** Escalated → then taken down ("we forced it through"). Subset of takenDown. */
    reTakenDown: number;
  };
  topAuBrands: RankedBrand[];
  globalBrands: RankedBrand[];
  topRegistrars: Array<{ registrar: string; clones: number }>;
  /** Rows whose registrar is redacted/unknown - reported for honesty, excluded
   *  from the leaderboard (rendered as a "N WHOIS-hidden" footnote). */
  unknownRegistrarCount: number;
  /** Live month-on-month comparison vs the prior calendar month. Computed by a
   *  second fetch+aggregate over the prior window (no dependency on the durable
   *  clone_watch_report_summary snapshot — that lands in WS3). Currently unrendered
   *  (the scale/MoM slide was cut from the 7-deck for the June baseline); retained
   *  because the recurring-automation build re-introduces a conditional MoM slide
   *  once there's an honest delta (July-vs-June onward). */
  mom: MonthOverMonth;
  /** The highest-ranked AU super fund among the impersonated brands, if any —
   *  powers the "super fund" spotlight slide. null when no watchlisted fund
   *  appears this month (the slide falls back to the evergreen "why it works"). */
  superFund: SuperFundSpotlight | null;
}

function monthWindow(month?: string): {
  startIso: string;
  endIso: string;
  label: string;
  periodMonth: string;
} {
  let start: Date;
  if (month) {
    // Normalise any YYYY-MM or YYYY-MM-DD input to the MONTH START, so a
    // full-date arg can't produce a partial-month window mislabelled as the
    // whole month.
    const ym = month.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      throw new Error(`invalid month "${month}" (expected YYYY-MM)`);
    }
    start = new Date(`${ym}-01T00:00:00Z`);
  } else {
    start = priorMonthStart(new Date());
  }
  if (Number.isNaN(start.getTime())) {
    throw new Error(`invalid month "${month}" (expected YYYY-MM)`);
  }
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
  );
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    periodMonth: start.toISOString().slice(0, 10),
    label: start.toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

/** Australian government domain (.gov.au, incl. state variants like .vic.gov.au). */
function isGovDomain(domain: string): boolean {
  return domain.toLowerCase().includes(".gov.");
}

/**
 * AU brand = an Australian TLD, excluding government (we rank "brands").
 *
 * NOTE: this is a TLD heuristic, so an AU company on a .com (e.g. Stake /
 * hellostake.com) is classified GLOBAL, and a multinational's .com.au shopfront
 * is classified AU. The clone watchlist has no is-AU flag to key off, so the
 * operator curates edge cases at approval time. Good enough for the ranking;
 * the total/brands counts are unaffected.
 */
function isAuBrand(domain: string): boolean {
  const d = domain.toLowerCase();
  return d.endsWith(".au") && !isGovDomain(d);
}

function sumClassification(
  byBrand: Map<string, CloneBrandMetrics>,
  cls: string,
): number {
  let n = 0;
  for (const m of byBrand.values()) n += m.byClassification[cls] ?? 0;
  return n;
}

/** Sum a numeric lifecycle metric across all brands. */
function sumMetric(
  byBrand: Map<string, CloneBrandMetrics>,
  key:
    | "takenDown"
    | "declined"
    | "escalated"
    | "weaponised"
    | "weaponisedAfterDecline"
    | "reTakenDown",
): number {
  let n = 0;
  for (const m of byBrand.values()) n += m[key] ?? 0;
  return n;
}

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

/**
 * Fetch + FP-filter + aggregate one calendar-month window into the digest's
 * per-brand metric map. Extracted so the same reconciled path serves both the
 * report month and its prior month (for the MoM delta).
 */
async function fetchMonthByBrand(
  sb: ServiceClient,
  startIso: string,
  endIso: string,
  periodMonth: string,
): Promise<Map<string, CloneBrandMetrics>> {
  const { data, error } = await sb
    .from("shopfront_clone_alerts")
    .select(
      "id, candidate_domain, inferred_target_domain, urlscan_classification, urlscan_evidence, attribution, submitted_to, lifecycle_state, netcraft_declined_at, weaponised_at",
    )
    .eq("source", CLONE_SOURCE)
    .gte("first_seen_at", startIso)
    .lt("first_seen_at", endIso)
    .not("inferred_target_domain", "is", null)
    .or("triage_status.is.null,triage_status.neq.fp")
    .limit(FETCH_LIMIT);

  if (error) throw new Error(`report-card fetch failed: ${error.message}`);

  // Warn on the RAW result length (pre-FP-filter), matching the digest, so an
  // FP row dropped after fetch can't mask a truncated (capped) DB result.
  const raw = (data ?? []) as unknown as CloneAlertRow[];
  if (raw.length === FETCH_LIMIT) {
    logger.warn("report-card: clone fetch hit LIMIT", {
      limit: FETCH_LIMIT,
      period: periodMonth,
    });
  }
  const rows = raw.filter((r) => !isFpBrand(r.inferred_target_domain));
  return aggregateClonesByDomain(rows);
}

export interface BrandTrendRow {
  brand: string;
  is_au: boolean;
  clones: number;
  reported_to_netcraft: number;
  likely_phishing: number;
  parked: number;
  taken_down: number;
  declined: number;
  escalated: number;
  weaponised: number;
}
export interface RegistrarTrendRow {
  registrar: string;
  clones: number;
}
export interface CloneWatchTrendRows {
  periodMonth: string; // "YYYY-MM-01"
  brandRows: BrandTrendRow[];
  registrarRows: RegistrarTrendRow[];
}

/**
 * Full per-brand + per-registrar rows for a month (NOT just the top-N the
 * report card keeps). Reuses the exact same reconciled aggregation as
 * getCloneWatchReportCard, so trend rows sum back to the summary card. Written
 * to the v193 trend tables by the monthly snapshot cron.
 */
export async function getCloneWatchTrendRows(
  month?: string,
): Promise<CloneWatchTrendRows> {
  const { startIso, endIso, periodMonth } = monthWindow(month);
  const sb = createServiceClient();
  if (!sb) throw new Error("service client unavailable");

  const byBrand = await fetchMonthByBrand(sb, startIso, endIso, periodMonth);

  const brandRows: BrandTrendRow[] = [...byBrand.entries()]
    .map(([brand, m]) => ({
      brand,
      is_au: isAuBrand(brand),
      clones: m.detected,
      reported_to_netcraft: m.netcraftReported,
      likely_phishing: m.byClassification["likely_phishing"] ?? 0,
      parked: m.byClassification["parked_for_sale"] ?? 0,
      taken_down: m.takenDown,
      declined: m.declined,
      escalated: m.escalated,
      weaponised: m.weaponised,
    }))
    .sort((a, b) => b.clones - a.clones || a.brand.localeCompare(b.brand));

  // Full canonicalised registrar list (not sliced) + drop the Unknown bucket —
  // its count already lives in clone_watch_report_summary.unknown_registrar_count.
  const { rows: rawRegistrars } = buildRegistrarRollup(byBrand);
  const registrarRows: RegistrarTrendRow[] = rollupRegistrars(rawRegistrars).map(
    (r) => ({ registrar: r.registrar, clones: r.clones }),
  );

  return { periodMonth, brandRows, registrarRows };
}

/** Sum detected clones + distinct brand count across a per-brand metric map. */
function totalsOf(byBrand: Map<string, CloneBrandMetrics>): {
  total: number;
  brands: number;
} {
  let total = 0;
  for (const m of byBrand.values()) total += m.detected;
  return { total, brands: byBrand.size };
}

/** The prior calendar month's window + labels, derived from a month start ISO. */
function priorWindow(startIso: string): {
  startIso: string;
  endIso: string;
  periodMonth: string;
  label: string;
} {
  const cur = new Date(startIso);
  const start = new Date(
    Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - 1, 1),
  );
  return {
    startIso: start.toISOString(),
    endIso: startIso, // the prior month ends exactly where the current begins
    periodMonth: start.toISOString().slice(0, 10),
    label: start.toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

/**
 * Build the monthly report-card figures for the given month (default: prior
 * calendar month). Reconciles exactly to the internal digest.
 *
 * Two reads per render (report month + prior month for the MoM delta) — admin
 * on-demand surface, force-dynamic, negligible traffic.
 */
export async function getCloneWatchReportCard(
  month?: string,
): Promise<CloneWatchReportCard> {
  const { startIso, endIso, label, periodMonth } = monthWindow(month);
  const sb = createServiceClient();
  if (!sb) throw new Error("service client unavailable");

  const byBrand = await fetchMonthByBrand(sb, startIso, endIso, periodMonth);

  // Reporting KPIs from the shared aggregate (deduped by candidate_domain).
  let total = 0;
  let reportedToNetcraft = 0;
  for (const m of byBrand.values()) {
    total += m.detected;
    reportedToNetcraft += m.netcraftReported;
  }

  // Live month-on-month delta: a second reconciled fetch over the prior window.
  const prevWin = priorWindow(startIso);
  const priorByBrand = await fetchMonthByBrand(
    sb,
    prevWin.startIso,
    prevWin.endIso,
    prevWin.periodMonth,
  );
  const prior = totalsOf(priorByBrand);
  // Only a fair comparison when BOTH months are fully tracked (see
  // FIRST_FULL_MONTH); otherwise the card renders a baseline, not a delta.
  const momAvailable =
    periodMonth.slice(0, 7) >= FIRST_FULL_MONTH &&
    prevWin.periodMonth.slice(0, 7) >= FIRST_FULL_MONTH &&
    prior.total > 0;
  const mom: MonthOverMonth = {
    available: momAvailable,
    priorLabel: prevWin.label,
    priorTotal: prior.total,
    priorBrands: prior.brands,
    totalDelta: total - prior.total,
    totalPct:
      prior.total > 0
        ? Math.round(((total - prior.total) / prior.total) * 100)
        : null,
    brandsDelta: byBrand.size - prior.brands,
  };

  // Registrar leaderboard: reuse the digest's rollup (single source of truth),
  // then canonicalise + drop the Unknown bucket. buildRegistrarRollup already
  // sums byRegistrar across brands; rollupRegistrars accepts its {registrar,
  // clones} row shape directly.
  const { rows: rawRegistrars, unknownCount } = buildRegistrarRollup(byBrand);
  const topRegistrars = rollupRegistrars(rawRegistrars).slice(0, 6);

  const ranked = [...byBrand.entries()]
    .map(([brand, m]) => ({ brand, clones: m.detected }))
    .sort((a, b) => b.clones - a.clones || a.brand.localeCompare(b.brand));

  // Super-fund spotlight: the highest-ranked super fund, with its rank among
  // Australian brands. Super funds ARE Australian brands even on a .com (e.g.
  // australiansuper.com) — which the .au TLD heuristic would classify "global"
  // and hide from the spotlight — so rank against AU brands PLUS watchlisted
  // funds. Ranked-desc order means findIndex picks the most-targeted fund.
  const isFund = (d: string) => SUPER_FUND_DOMAINS.has(d.toLowerCase());
  const auOrFund = ranked.filter((r) => isAuBrand(r.brand) || isFund(r.brand));
  const sfIdx = auOrFund.findIndex((r) => isFund(r.brand));
  const superFund: SuperFundSpotlight | null =
    sfIdx >= 0
      ? {
          brand: auOrFund[sfIdx].brand,
          clones: auOrFund[sfIdx].clones,
          auRank: sfIdx + 1,
        }
      : null;

  return {
    periodMonth,
    periodLabel: label,
    total,
    brands: byBrand.size,
    kpis: {
      reportedToNetcraft,
      likelyPhishing: sumClassification(byBrand, "likely_phishing"),
      parkedForSale: sumClassification(byBrand, "parked_for_sale"),
      takenDown: sumMetric(byBrand, "takenDown"),
      declined: sumMetric(byBrand, "declined"),
      escalated: sumMetric(byBrand, "escalated"),
      weaponised: sumMetric(byBrand, "weaponised"),
      weaponisedAfterDecline: sumMetric(byBrand, "weaponisedAfterDecline"),
      reTakenDown: sumMetric(byBrand, "reTakenDown"),
    },
    // Gov domains are excluded from BOTH public rankings (they're neither
    // consumer "brands" nor global); they still count toward total/brands.
    topAuBrands: ranked.filter((r) => isAuBrand(r.brand)).slice(0, 8),
    globalBrands: ranked
      .filter((r) => !isAuBrand(r.brand) && !isGovDomain(r.brand))
      .slice(0, 5),
    topRegistrars,
    unknownRegistrarCount: unknownCount,
    mom,
    superFund,
  };
}
