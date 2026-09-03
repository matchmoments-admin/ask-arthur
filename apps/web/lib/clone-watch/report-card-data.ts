import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import {
  aggregateClonesByDomain,
  priorMonthStart,
  type CloneAlertRow,
  type CloneBrandMetrics,
} from "@/app/api/inngest/functions/report-brand-stewardship";
import { buildRegistrarRollup } from "@/app/api/inngest/functions/clone-watch-internal-digest";
import {
  summariseCampaigns,
  type CampaignSummary,
} from "@/lib/clone-watch/campaign-summary";
import {
  computeDurationKpis,
  registrarWeaponisation,
  tldWeaponisation,
  type DurationKpis,
  type RegistrarWeaponisationRow,
} from "@/lib/clone-watch/duration-kpis";
import {
  applyCohortRules,
  CLONE_COHORT_SELECT,
  CLONE_COHORT_SOURCE,
} from "@/lib/clone-watch/clone-cohort";
import {
  computeTargetingIntel,
  type TargetingIntel,
} from "@/lib/clone-watch/targeting-intelligence";
import {
  classifyTrend,
  narrowestCoverage,
  summariseTrendExclusions,
  type BrandCoverage,
  type TrendVerdict,
} from "@/lib/clone-watch/brand-coverage";
import {
  computeTargetingIntelByBrand,
  type HostingSummary,
  type InfrastructureCluster,
  type Mix,
} from "@/lib/clone-watch/targeting-intelligence";
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

// The window/source/FP filters come from clone-cohort.ts, so counts reconcile
// with the digest by construction rather than by two files agreeing.
//
// A REACHABLE ceiling. The previous value was 5000, passed to `.limit()` and
// then guarded with `raw.length === FETCH_LIMIT` — but PostgREST caps every
// response at 1000 rows, so the guard compared against a number the server can
// never return and never fired. July 2026 published "1000 detected" when the
// truth was 1064. We now paginate, and this bound is checked against the paged
// total, which CAN reach it.
const FETCH_LIMIT = 20_000;

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

/** Which story earned slide 3 this month. The ladder exists because a
 *  category-only rule repeats: HESTA was the top super fund in both June and
 *  July 2026, so it took the spotlight twice while the month's actual news
 *  (Apple 42→85, Google 21→54, two first-time entrants) went untold. */
export type SpotlightKind = "mover" | "new_entrant" | "super_fund" | "globals";

export interface Spotlight {
  kind: SpotlightKind;
  /** Domain of the spotlit brand; empty for the "globals" fallback. */
  brand: string;
  clones: number;
  /** 1-based rank among AU brands + funds; 0 when not applicable. */
  auRank: number;
  /** Prior-month clone count — present for movers (0 for new entrants). */
  priorClones?: number;
  /** clones - priorClones, present for movers. */
  delta?: number;
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
    /**
     * The rest of the classification axis. `likely_phishing` + `parked_for_sale`
     * are two of FIVE mutually-exclusive buckets that partition the cohort, and
     * showing only those two left the slide's numbers unable to reconcile
     * against its own headline. These three complete it:
     *   neutral      — resolved, nothing auto-classified, awaiting human review
     *   unresolved   — we scanned it and the page didn't render
     *   unclassified — we never obtained a verdict at all (the stranded cohort)
     */
    neutral: number;
    unresolved: number;
    unclassified: number;
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
  /**
   * Per-brand month-over-month verdicts + the exclusion counts the published
   * caveat is built from (#1075). Computed live here rather than read back from
   * clone_watch_monthly_brand_stats, so the admin preview and the published
   * post cannot disagree, and so the cron has no write-then-read ordering
   * hazard with its own later step.
   */
  brandTrends: BrandTrendGate;
  /**
   * Cohort-level targeting characterisation — the shape half of the report
   * (tactic / TLD / hosting / clusters). Computed from the same rows as every
   * other figure on the card, so slide and caption cannot disagree.
   */
  targeting: TargetingIntel;
  /** The highest-ranked AU super fund among the impersonated brands, if any —
   *  powers the "super fund" spotlight slide. null when no watchlisted fund
   *  appears this month (the slide falls back to the evergreen "why it works"). */
  superFund: SuperFundSpotlight | null;
  /** Slide 3's subject, chosen by news value and never repeating last month's
   *  (see SpotlightKind). Falls back to "globals" when nothing else qualifies. */
  spotlight: Spotlight;
  /** The vendor-gap clock over THIS month's first_seen_at cohort. Cohort
   *  medians — expected to differ from the rolling-event-window
   *  clone_watch_vendor_gap_stats RPC that feeds the public panel. */
  durations: DurationKpis;
  /** Which registrars' clones weaponise, and how fast (canonicalised;
   *  explicit Unknown bucket rendered for honesty). */
  registrarWeaponisation: RegistrarWeaponisationRow[];
  /** Per-TLD weaponisation counts (card-render only, not persisted). */
  tldWeaponisation: Array<{ tld: string; weaponised: number }>;
  /** Coordinated campaigns (>=2 lookalikes sharing an actor fingerprint, v235)
   *  over this month's cohort — the "one actor, N of your domains" story.
   *  Empty until FF_CLONE_CAMPAIGNS has stamped campaign_key on the cohort. */
  campaigns: CampaignSummary;
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
): Promise<{ byBrand: Map<string, CloneBrandMetrics>; rows: CloneAlertRow[] }> {
  // `.order("id")` is load-bearing, not cosmetic: a .range() walk over an
  // unordered query can skip and repeat rows between pages.
  const {
    rows: raw,
    truncated,
    error,
  } = await fetchAllRows<CloneAlertRow>(
    (from, to) =>
      sb
        .from("shopfront_clone_alerts")
        // The cohort's own SELECT (clone-cohort.ts) — shared with the
        // brand-stewardship digest so the two cannot drift. It was two inline
        // lists until now, and the drift already cost `clone_tactic` once: the
        // column simply arrived undefined, which reads as thin classifier
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

  // Warn on the RAW count (pre-FP-filter), matching the digest, so an FP row
  // dropped after fetch can't mask a truncated result.
  if (truncated) {
    logger.warn("report-card: clone fetch hit LIMIT", {
      limit: FETCH_LIMIT,
      period: periodMonth,
    });
  }
  const rows = applyCohortRules(raw);
  return { byBrand: aggregateClonesByDomain(rows), rows };
}

export interface BrandTrendGate {
  /** Brands whose movement may be published, largest rise first. */
  claimable: Array<{ brand: string; clones: number; priorClones: number; delta: number; pct: number | null }>;
  /** Why the rest were withheld — the caveat's numbers. */
  excluded: ReturnType<typeof summariseTrendExclusions>;
  /**
   * False when coverage could not be read at all. The gate fails closed: no
   * trend claim may be published from a card whose coverage basis is unknown.
   */
  publishable: boolean;
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
  // ── targeting characterisation (v296) ──────────────────────────────────
  // Shape rather than volume: how the names were built, where they were
  // hosted, what infrastructure they shared. Each jsonb carries its own
  // denominator and unknown bucket (see targeting-intelligence.ts `Mix`)
  // because the source fields have very different coverage.
  deliberate_clones: number;
  tactic_mix: Mix;
  intent_mix: Mix;
  tld_mix: Mix;
  hosting_mix: HostingSummary;
  clusters: InfrastructureCluster[];
  fingerprinted_clones: number;
  largest_cluster: number;
}
export interface RegistrarTrendRow {
  registrar: string;
  clones: number;
  /** Clones of this registrar that weaponised this month (v231 column). */
  weaponised: number;
  /** Median days first_seen_at → weaponised_at; null when weaponised = 0. */
  median_days_to_weaponise: number | null;
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

  const { byBrand, rows } = await fetchMonthByBrand(
    sb,
    startIso,
    endIso,
    periodMonth,
  );

  // Per-brand characterisation over the SAME already-fetched rows — no second
  // query. Keyed on inferred_target_domain, which is exactly the key `byBrand`
  // and clone_watch_monthly_brand_stats.brand use (it flows from the
  // watchlist's legitimate_domains[0] through the ingest); keying on a
  // normalised brand name would join to nothing (see migration v295).
  const intelByBrand = computeTargetingIntelByBrand(rows);
  const emptyMix: Mix = { top: [], other: 0, unknown: 0, total: 0 };

  const brandRows: BrandTrendRow[] = [...byBrand.entries()]
    .map(([brand, m]) => {
      const intel = intelByBrand.get(brand);
      return {
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
        deliberate_clones: intel?.tactics.total ?? 0,
        tactic_mix: intel?.tactics ?? emptyMix,
        intent_mix: intel?.intents ?? emptyMix,
        tld_mix: intel?.tlds ?? emptyMix,
        hosting_mix:
          intel?.hosting ?? {
            asns: emptyMix,
            countries: emptyMix,
            frontedN: 0,
            unattributedN: 0,
            originVisibleN: 0,
            total: 0,
          },
        clusters: intel?.clusters.clusters ?? [],
        fingerprinted_clones: intel?.clusters.fingerprintedN ?? 0,
        largest_cluster: intel?.clusters.largestClusterN ?? 0,
      };
    })
    .sort((a, b) => b.clones - a.clones || a.brand.localeCompare(b.brand));

  // Full canonicalised registrar list (not sliced) + drop the Unknown bucket —
  // its count already lives in clone_watch_report_summary.unknown_registrar_count.
  // The weaponisation cut joins on the SAME canonical name, so the two can't
  // split a vendor across spellings; its Unknown bucket is likewise dropped
  // here (rendered on the internal card only).
  const weaponisationByRegistrar = new Map(
    registrarWeaponisation(rows).map((w) => [w.registrar, w]),
  );
  const { rows: rawRegistrars } = buildRegistrarRollup(byBrand);
  const registrarRows: RegistrarTrendRow[] = rollupRegistrars(
    rawRegistrars,
  ).map((r) => ({
    registrar: r.registrar,
    clones: r.clones,
    weaponised: weaponisationByRegistrar.get(r.registrar)?.weaponised ?? 0,
    median_days_to_weaponise:
      weaponisationByRegistrar.get(r.registrar)?.medianDaysToWeaponise ?? null,
  }));

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

  const { byBrand, rows } = await fetchMonthByBrand(
    sb,
    startIso,
    endIso,
    periodMonth,
  );

  // Reporting KPIs from the shared aggregate (deduped by candidate_domain).
  let total = 0;
  let reportedToNetcraft = 0;
  for (const m of byBrand.values()) {
    total += m.detected;
    reportedToNetcraft += m.netcraftReported;
  }

  // Live month-on-month delta: a second reconciled fetch over the prior window.
  const prevWin = priorWindow(startIso);
  const { byBrand: priorByBrand } = await fetchMonthByBrand(
    sb,
    prevWin.startIso,
    prevWin.endIso,
    prevWin.periodMonth,
  );
  const prior = totalsOf(priorByBrand);

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
  // Only a fair comparison when BOTH months are fully tracked (see
  // FIRST_FULL_MONTH); otherwise the card renders a baseline, not a delta.
  const momAvailable =
    periodMonth.slice(0, 7) >= FIRST_FULL_MONTH &&
    prevWin.periodMonth.slice(0, 7) >= FIRST_FULL_MONTH &&
    prior.total > 0;
  // Coverage for BOTH months, keyed by brand domain — the key byBrand uses.
  // A read failure yields an empty map, which makes every verdict
  // coverage_unknown and the gate unpublishable; degraded reads must never
  // quietly become "no exclusions".
  const coverageByBrand = new Map<string, BrandCoverage>();
  let coverageReadOk = true;
  {
    const { data, error } = await sb
      .from("brand_coverage_history")
      .select("brand, brand_normalized, brand_domain, covered_from, covered_to");
    if (error) {
      coverageReadOk = false;
      logger.warn("report-card: brand coverage read failed", { error: error.message });
    } else {
      for (const r of data ?? []) {
        const row = r as {
          brand_normalized: string;
          brand_domain: string;
          covered_from: string;
          covered_to: string | null;
        };
        // Several brands can share one brand_domain (three do today), so rows
        // are INTERSECTED into the window where all of them were watched — see
        // narrowestCoverage. Unioning them fails the gate open.
        coverageByBrand.set(
          row.brand_domain,
          narrowestCoverage(coverageByBrand.get(row.brand_domain), {
            brandDomain: row.brand_domain,
            brandNormalized: row.brand_normalized,
            coveredFrom: row.covered_from,
            coveredTo: row.covered_to,
          }),
        );
      }
    }
  }

  const priorYm = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  priorYm.setUTCMonth(priorYm.getUTCMonth() - 1);
  const priorPeriod = priorYm.toISOString().slice(0, 7);
  const verdicts: TrendVerdict[] = [];
  const verdictByBrand = new Map<string, TrendVerdict>();
  const claimable: BrandTrendGate["claimable"] = [];
  for (const [brand, m] of byBrand) {
    const priorClones = priorByBrand.get(brand)?.detected ?? 0;
    const v = classifyTrend({
      currentClones: m.detected,
      priorClones,
      currentMonth: periodMonth.slice(0, 7),
      priorMonth: priorPeriod,
      coverage: coverageByBrand.get(brand),
    });
    verdicts.push(v);
    verdictByBrand.set(brand, v);
    if (v.kind === "claimable" && v.delta !== 0) {
      claimable.push({ brand, clones: m.detected, priorClones, delta: v.delta, pct: v.pct });
    }
  }
  claimable.sort((a, b) => b.delta - a.delta || a.brand.localeCompare(b.brand));

  const brandTrends: BrandTrendGate = {
    claimable,
    excluded: summariseTrendExclusions(verdicts),
    publishable: coverageReadOk && coverageByBrand.size > 0,
  };

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

  // ── Spotlight ladder (slide 3) ────────────────────────────────────────────
  // Priority: biggest MoM mover → first-time entrant → super fund → globals.
  // A candidate matching LAST month's spotlight is skipped at every rung, so
  // the series can't tell the same story twice running.
  const MOVER_MIN_DELTA = 10; // ignore noise-level movement
  const ENTRANT_MIN_CLONES = 10; // a first-timer must be material to lead
  // Both comparative rungs REQUIRE a fair prior month. Without this, a month
  // with no comparable prior window (month one, or a data gap) makes
  // priorClonesOf() return 0 for every brand — which disables the mover rung
  // and makes EVERY brand look like a first-time entrant. The caption would
  // then publish "wasn't targeted at all last month" directly above its own
  // "This is month one" line (review finding 5).
  const priorClonesOf = (brand: string) =>
    priorByBrand.get(brand)?.detected ?? 0;
  const notLastMonth = (brand: string) =>
    !priorSpotlightBrand ||
    brand.toLowerCase() !== priorSpotlightBrand.toLowerCase();

  // BOTH comparative rungs must pass the coverage gate, not merely the volume
  // thresholds. Without this the gate is decorative: it was fully tested, its
  // caveat was printed in the caption, and the publisher beside it applied none
  // of it. The Ordinary (1 -> 11) clears priorClones > 0 and delta >= 10, so it
  // would have been published as "the month's sharpest riser" — the exact
  // sentence brand_coverage_history exists to prevent, with the gate's own
  // "these brands were excluded" caveat printed underneath it.
  //
  // `claimable` also requires coverage of BOTH months, which subsumes the
  // "fair prior month" reasoning the momAvailable guard below encodes per-brand
  // rather than per-cohort.
  const isClaimable = (brand: string) =>
    brandTrends.publishable && verdictByBrand.get(brand)?.kind === "claimable";

  const mover = !momAvailable
    ? undefined
    : auOrFund
        .map((r) => ({
          ...r,
          priorClones: priorClonesOf(r.brand),
          delta: r.clones - priorClonesOf(r.brand),
        }))
        .filter(
          (r) =>
            isClaimable(r.brand) &&
            r.priorClones > 0 &&
            r.delta >= MOVER_MIN_DELTA &&
            notLastMonth(r.brand),
        )
        .sort((a, b) => b.delta - a.delta)[0];

  const entrant = !momAvailable
    ? undefined
    : auOrFund
        .filter(
          (r) =>
            // "It wasn't targeted at all last month" is precisely what a
            // mid-month watchlist addition manufactures, so this rung needs the
            // gate even more than the mover does.
            isClaimable(r.brand) &&
            priorClonesOf(r.brand) === 0 &&
            r.clones >= ENTRANT_MIN_CLONES &&
            notLastMonth(r.brand),
        )
        .sort((a, b) => b.clones - a.clones)[0];

  const rankOf = (brand: string) =>
    auOrFund.findIndex((r) => r.brand === brand) + 1;
  const spotlight: Spotlight = mover
    ? {
        kind: "mover",
        brand: mover.brand,
        clones: mover.clones,
        auRank: rankOf(mover.brand),
        priorClones: mover.priorClones,
        delta: mover.delta,
      }
    : entrant
      ? {
          kind: "new_entrant",
          brand: entrant.brand,
          clones: entrant.clones,
          auRank: rankOf(entrant.brand),
          priorClones: 0,
        }
      : superFund && notLastMonth(superFund.brand)
        ? {
            kind: "super_fund",
            brand: superFund.brand,
            clones: superFund.clones,
            auRank: superFund.auRank,
          }
        : { kind: "globals", brand: "", clones: 0, auRank: 0 };

  return {
    periodMonth,
    periodLabel: label,
    total,
    brands: byBrand.size,
    kpis: {
      reportedToNetcraft,
      likelyPhishing: sumClassification(byBrand, "likely_phishing"),
      parkedForSale: sumClassification(byBrand, "parked_for_sale"),
      neutral: sumClassification(byBrand, "neutral"),
      unresolved: sumClassification(byBrand, "unresolved"),
      unclassified: sumClassification(byBrand, "unclassified"),
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
    brandTrends,
    targeting: computeTargetingIntel(rows),
    superFund,
    spotlight,
    // The vendor-gap clock + weaponisation cuts, computed over the SAME
    // FP-filtered cohort rows the aggregate came from (one fetch, no drift).
    durations: computeDurationKpis(rows),
    registrarWeaponisation: registrarWeaponisation(rows),
    tldWeaponisation: tldWeaponisation(rows),
    // Coordinated-campaign clustering over the same cohort (single fetch, no
    // drift). Empty until campaign_key is populated (FF_CLONE_CAMPAIGNS).
    campaigns: summariseCampaigns(rows),
  };
}
