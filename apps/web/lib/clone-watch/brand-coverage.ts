/**
 * Brand coverage + the month-over-month trend gate (v294, #1075).
 *
 * A targeting trend is only a fact about attackers if we were watching the
 * brand for the WHOLE of both periods. Otherwise a coverage start reads
 * exactly like a surge: The Ordinary went 1 -> 11 and Mecca 3 -> 12 between
 * July and August 2026, which looks like a campaign and is actually the
 * 2026-07-21 watchlist commit that first added them (with nine other beauty
 * brands). Both were candidate headlines for the first public report.
 *
 * So `classifyTrend` is the single home of the publish decision, and the copy
 * takes its excluded-count from the same function that made it — a hand-counted
 * caveat drifts from the gate, a derived one cannot.
 *
 * Pure: no I/O, no imports beyond types. Mirrors the shape of duration-kpis.ts
 * (v222 convention — one formula, one home in TS).
 */

/**
 * A coverage window from `brand_coverage_history`. `coveredTo` null = current.
 *
 * KEYS: `brandDomain` (legitimate_domains[0], e.g. "apple.com") is the join key
 * for `clone_watch_monthly_brand_stats.brand` and
 * `shopfront_clone_alerts.inferred_target_domain` — use it for anything reading
 * the monthly stats. `brandNormalized` ("apple") joins to
 * `shopfront_clone_alerts.target_brand_normalized` instead. Both are carried
 * because the two halves of the pipeline are keyed differently; joining on the
 * wrong one returns NOTHING and, because this gate fails closed, silently
 * suppresses every trend claim while appearing to work (v295).
 */
export interface BrandCoverage {
  brandDomain: string;
  brandNormalized: string;
  coveredFrom: string; // YYYY-MM-DD
  coveredTo: string | null;
}

export type TrendKind =
  /** Covered throughout both months and above the floor — safe to publish. */
  | "claimable"
  /** Monitoring began inside the window: a rise here is OUR change, not theirs. */
  | "coverage_started"
  /**
   * Monitoring STOPPED inside the window. Distinct from coverage_started
   * because the derived caveat states the reason: saying "we started watching
   * these" about brands we stopped watching is the opposite of what happened,
   * and this module's whole argument is that a derived caveat cannot drift
   * from the gate.
   */
  | "coverage_ended"
  /** Too few clones for the movement to mean anything. */
  | "below_floor"
  /** No coverage record at all — treated as unpublishable, never as covered. */
  | "coverage_unknown";

export interface TrendVerdict {
  kind: TrendKind;
  delta: number;
  /** Only present when kind === "claimable" AND both months clear the floor. */
  pct: number | null;
}

/**
 * Minimum clones for a movement to be publishable.
 *
 * Matches MEDIAN_FLOOR's role in duration-kpis.ts: a threshold below which a
 * number is real but not meaningful. At n<10 a single opportunist registering
 * three domains is a "+150% rise" — true arithmetic, false impression. Most
 * Australian banks sit below this every month (August: ubank 13, ING 6,
 * Westpac 3, NAB 1), which is a fact about their clone volume, not a defect.
 */
export const TREND_FLOOR = 10;

/**
 * Throws on an unparseable month rather than returning Invalid Date.
 *
 * `new Date("2026-8-01T00:00:00Z")` (unpadded) is Invalid Date, and EVERY
 * comparison against NaN is false — so `coveredForWholeMonth` would skip both
 * rejection branches and return true, making every brand claimable. A gate
 * whose contract is "a missing record is never treated as covered" must not
 * fail open on a malformed input.
 */
function monthStart(periodMonth: string): Date {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`brand-coverage: unparseable periodMonth "${periodMonth}"`);
  }
  return d;
}

/**
 * Was the brand covered for the entire calendar month?
 *
 * Deliberately strict: coverage must begin on or BEFORE the first day of the
 * month. A brand added mid-month has a partial month, and a partial month
 * compared against a full one manufactures a rise.
 */
export function coveredForWholeMonth(
  coverage: BrandCoverage | null | undefined,
  periodMonth: string,
): boolean {
  return monthCoverage(coverage, periodMonth) === "covered";
}

type MonthCoverage = "covered" | "started_late" | "ended_early" | "absent";

/** Why a month is or is not fully covered — the reason the caveat needs. */
function monthCoverage(
  coverage: BrandCoverage | null | undefined,
  periodMonth: string,
): MonthCoverage {
  if (!coverage) return "absent";
  const start = monthStart(periodMonth);
  const nextMonth = new Date(start);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

  if (new Date(`${coverage.coveredFrom}T00:00:00Z`) > start) return "started_late";
  if (coverage.coveredTo) {
    // `coveredTo` is a DETECTION date, not a departure date — the only writer is
    // the monthly cron, which stamps its own run date (the 1st of M+1) for a
    // brand it finds missing. So a stamp of 2026-09-01 means "gone by 1 Sep",
    // and the brand may have left on 2 August.
    //
    // Hence `<=`, not `<`. Under the strict test the gate failed OPEN on exactly
    // the mirror of the case it was built for: a brand deleted on 10 August is
    // stamped 2026-09-01, `2026-09-01 < 2026-09-01` is false, August reads fully
    // covered, and a 40 -> 12 drop across 21 unmonitored days publishes as a
    // real collapse in targeting. The last month this brand is PROVABLY whole is
    // the one that ended before the stamp — July, which the 1 August snapshot
    // saw it in — and `<=` says exactly that.
    if (new Date(`${coverage.coveredTo}T00:00:00Z`) <= nextMonth) return "ended_early";
  }
  return "covered";
}

/**
 * The brands whose coverage spans the WHOLE of `periodMonth`.
 *
 * Takes every coverage row for one `brandDomain`, because coverage is recorded
 * per BRAND while the monthly stats are keyed by DOMAIN and several brands can
 * share one. `servicesaustralia.gov.au` carries three rows in prod — Services
 * Australia from 2026-05-26, Medicare and Centrelink from 2026-06-16 — so that
 * domain's clone count is a bucket whose *composition* changed mid-June.
 *
 * Returned as a set of brand names rather than a merged window, because "was
 * this comparable across two months" is a question about the contributing SET,
 * which a single interval cannot express: a brand de-listed and later re-added
 * has two disjoint rows, and any single window spanning them is a fiction.
 */
export function brandsCoveredForMonth(
  rows: readonly BrandCoverage[],
  periodMonth: string,
): Set<string> {
  const covered = new Set<string>();
  for (const row of rows) {
    if (monthCoverage(row, periodMonth) === "covered") covered.add(row.brandNormalized);
  }
  return covered;
}

/**
 * Decide whether a domain's month-over-month movement may be published.
 *
 * `coverage` is EVERY row for the domain. The movement is comparable only when
 * the same set of brands fed the bucket, fully monitored, in both months —
 * anything else is our own measurement changing shape. Taking the union of the
 * rows instead (an "earliest start wins" merge) made June-vs-July "3 -> 13"
 * claimable for servicesaustralia.gov.au: a +10 delta that clears the mover
 * threshold and is substantially the 16 June watchlist commit widening the
 * sweep mid-month, not attacker behaviour.
 *
 * Order matters: coverage is checked BEFORE the floor, so a newly-monitored
 * brand is reported as `coverage_started` rather than `below_floor` — the two
 * warrant different copy ("we started watching" vs "too small to call") and
 * conflating them would hide the confound behind a volume excuse.
 */
export function classifyTrend(input: {
  currentClones: number;
  priorClones: number;
  currentMonth: string;
  priorMonth: string;
  coverage: readonly BrandCoverage[] | null | undefined;
}): TrendVerdict {
  const { currentClones, priorClones, currentMonth, priorMonth, coverage } = input;
  const delta = currentClones - priorClones;

  if (!coverage || coverage.length === 0) {
    return { kind: "coverage_unknown", delta, pct: null };
  }

  const prior = brandsCoveredForMonth(coverage, priorMonth);
  const current = brandsCoveredForMonth(coverage, currentMonth);

  // Report WHICH way the coverage moved. A brand de-listed mid-window looks
  // identical to a collapse in targeting, and calling that "we started
  // watching" would be precisely backwards. Losing a brand takes precedence:
  // it is the direction that overstates attacker retreat.
  const dropped = [...prior].some((b) => !current.has(b));
  if (dropped) return { kind: "coverage_ended", delta, pct: null };
  const gained = [...current].some((b) => !prior.has(b));
  if (gained) return { kind: "coverage_started", delta, pct: null };
  if (prior.size === 0) {
    // Neither month was covered, so neither set names the reason. A row that
    // was closed at some point is a brand we stopped watching; one that never
    // closed simply had not started yet.
    const everClosed = coverage.some((r) => r.coveredTo !== null);
    return {
      kind: everClosed ? "coverage_ended" : "coverage_started",
      delta,
      pct: null,
    };
  }

  if (currentClones < TREND_FLOOR && priorClones < TREND_FLOOR) {
    return { kind: "below_floor", delta, pct: null };
  }

  // A percentage needs a trustworthy denominator, so it requires the floor in
  // BOTH months. Clearing it in only one month still earns an absolute delta —
  // "+10 domains" is honest where "+167%" (iinet, 6 -> 16) is not.
  const pct =
    priorClones >= TREND_FLOOR && currentClones >= TREND_FLOOR
      ? Math.round((delta / priorClones) * 100)
      : null;

  return { kind: "claimable", delta, pct };
}

/**
 * Counts for the post's caveat line, derived from the same verdicts it describes.
 *
 * `claimable` counts brands that both cleared the gate AND actually moved,
 * because that is the set the publisher lists (`delta !== 0`). Counting flat
 * brands here too made the caveat promise more rows than the post could show —
 * the drift this whole module exists to prevent, reintroduced one field over.
 * They are reported separately as `unchanged`: a real, publishable fact, but not
 * a withheld one, so it stays out of the exclusion tally.
 */
export function summariseTrendExclusions(
  verdicts: TrendVerdict[],
): {
  claimable: number;
  unchanged: number;
  coverageStarted: number;
  coverageEnded: number;
  belowFloor: number;
  unknown: number;
} {
  return {
    claimable: verdicts.filter((v) => v.kind === "claimable" && v.delta !== 0).length,
    unchanged: verdicts.filter((v) => v.kind === "claimable" && v.delta === 0).length,
    coverageStarted: verdicts.filter((v) => v.kind === "coverage_started").length,
    coverageEnded: verdicts.filter((v) => v.kind === "coverage_ended").length,
    belowFloor: verdicts.filter((v) => v.kind === "below_floor").length,
    unknown: verdicts.filter((v) => v.kind === "coverage_unknown").length,
  };
}
