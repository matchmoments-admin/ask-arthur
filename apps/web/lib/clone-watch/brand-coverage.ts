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
    // Must still be covered at the END of the month.
    if (new Date(`${coverage.coveredTo}T00:00:00Z`) < nextMonth) return "ended_early";
  }
  return "covered";
}

/**
 * Decide whether a brand's month-over-month movement may be published.
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
  coverage: BrandCoverage | null | undefined;
}): TrendVerdict {
  const { currentClones, priorClones, currentMonth, priorMonth, coverage } = input;
  const delta = currentClones - priorClones;

  if (!coverage) return { kind: "coverage_unknown", delta, pct: null };

  const prior = monthCoverage(coverage, priorMonth);
  const current = monthCoverage(coverage, currentMonth);
  if (prior !== "covered" || current !== "covered") {
    // Report WHICH way the coverage moved. A brand de-listed mid-window looks
    // identical to a collapse in targeting, and calling that "we started
    // watching" would be precisely backwards.
    const ended = prior === "ended_early" || current === "ended_early";
    return { kind: ended ? "coverage_ended" : "coverage_started", delta, pct: null };
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

/** Counts for the post's caveat line, derived from the same verdicts it describes. */
export function summariseTrendExclusions(
  verdicts: TrendVerdict[],
): {
  claimable: number;
  coverageStarted: number;
  coverageEnded: number;
  belowFloor: number;
  unknown: number;
} {
  return {
    claimable: verdicts.filter((v) => v.kind === "claimable").length,
    coverageStarted: verdicts.filter((v) => v.kind === "coverage_started").length,
    coverageEnded: verdicts.filter((v) => v.kind === "coverage_ended").length,
    belowFloor: verdicts.filter((v) => v.kind === "below_floor").length,
    unknown: verdicts.filter((v) => v.kind === "coverage_unknown").length,
  };
}
