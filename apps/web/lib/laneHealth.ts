/**
 * Clone-watch lane health — the "ran, did nothing, reported ok:true" detector
 * (#1145, map #1143). The decision half of health-digest's fourth check, the
 * same seam as feedHealth.ts: rows in, problems out, no I/O.
 *
 * Twice the feature went to zero while every function returned `ok: true` and
 * every cost row was honest: the recheck lane logged `rechecked 0 /
 * submit_failed 50` daily from Sep 9 (#1127's worklist starvation) and the
 * submit lane logged `units 75, submitted 0, failed 0, rate_limited 0` daily
 * from Sep 12 (#1124's spanning budget expiring at index 0). Neither shape
 * alerted anywhere; both were found by a human reading cost_telemetry a week
 * later. This module is the table of those shapes, one per lane, evaluated
 * against the lane's most recent rows.
 *
 * Two rules from the feed-health incident carry over:
 *
 *   - Start from the ROSTER, not from what is present in the log. A lane that
 *     stops writing drops out of any query grouped by what is there, so the
 *     harder it failed the more certainly it was invisible. LANE_SHAPES is the
 *     roster; a lane with no row inside its `expectEvery` window is `absent`.
 *   - Never gate proof-of-life on "nothing to report" (#884). The digest
 *     records lanes_checked whether or not anything fired.
 *
 * Lanes with NO per-run cost row (notify-brand, notify-weaponised,
 * enforcement-*, auto-triage, reemergence, enrich-attribution, report-summary,
 * the digests, scan-one) cannot be watched from telemetry and are not listed
 * here — listing them would be a guard that reads as protection. They are the
 * graduated ticket "every lane logs one outcome row per run".
 */

export type LaneProblemKind =
  /** No row inside the lane's expected window. */
  | "absent"
  /** Rows arrive on schedule and every one is a no-op. */
  | "silent_zero"
  /** The lane says it is braked / paused. */
  | "braked";

export interface LaneProblem {
  lane: string;
  kind: LaneProblemKind;
  detail: string;
}

/** A cost_telemetry row, as the digest selects it. */
export interface LaneCostRow {
  feature: string;
  operation: string;
  created_at: string;
  /** The row's own `units` column — submit_batch logs candidates here, not in metadata. */
  units: number | null;
  metadata: Record<string, unknown> | null;
}

/** Predicates see the row's `units` beside its metadata keys. */
const metaOf = (r: LaneCostRow): Meta => ({
  units: r.units ?? 0,
  ...(r.metadata ?? {}),
});

type Meta = Record<string, unknown>;

const num = (m: Meta, k: string): number => {
  const v = m[k];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

export interface LaneShape {
  /** Human name, matches the Inngest function id without the app prefix. */
  lane: string;
  feature: string;
  operation: string;
  /** Longest gap between rows that is still healthy, in ms. */
  expectEvery: number;
  /**
   * How many consecutive most-recent rows must ALL be zero before it counts.
   * 1 = one bad run pages (daily lanes); 3 = tolerate two quiet runs (lanes
   * that run several times a day and legitimately find nothing sometimes).
   */
  consecutive: number;
  /** True when this row is "did nothing while reporting success". */
  silentZero: (m: Meta) => boolean;
  /** Optional: true when this row says the lane is braked. */
  braked?: (m: Meta) => boolean;
  /** Short description of the shape for the digest line. */
  shape: string;
}

const H = 3_600_000;

/**
 * The roster. Predicates are written against the metadata each lane actually
 * logs (docs/ops/clone-watch-config.md §4b lists a sample row per lane);
 * `num()` reads a missing key as 0, so a lane that stops logging a field
 * reads as zero — loud, not silent.
 */
export const LANE_SHAPES: LaneShape[] = [
  {
    lane: "shopfront-clone-lifecycle-recheck",
    feature: "shopfront_clone_recheck",
    operation: "recheck_batch",
    expectEvery: 9 * H, // 6h cron + slack
    consecutive: 2,
    shape: "pool>0 ∧ rechecked=0, or every recheck failed to submit",
    silentZero: (m) =>
      (num(m, "pool") > 0 && num(m, "rechecked") === 0) ||
      (num(m, "rechecked") > 0 &&
        num(m, "submitted") === 0 &&
        num(m, "submit_failed") >= num(m, "rechecked")),
  },
  {
    lane: "shopfront-clone-urlscan-submit",
    feature: "shopfront_clone_urlscan",
    operation: "submit_batch",
    expectEvery: 26 * H, // daily 09:00
    consecutive: 1,
    shape: "units>0 ∧ submitted=0 ∧ rate_limited=0",
    silentZero: (m) =>
      num(m, "units") > 0 &&
      num(m, "submitted") === 0 &&
      num(m, "rate_limited") === 0,
  },
  {
    lane: "shopfront-clone-urlscan-retrieve",
    feature: "shopfront_clone_urlscan",
    operation: "retrieve_batch",
    expectEvery: 9 * H,
    consecutive: 3,
    shape: "classified=0 while still_pending>0, or unnotified_weaponised>0",
    silentZero: (m) =>
      (num(m, "classified") === 0 && num(m, "still_pending") > 0) ||
      num(m, "unnotified_weaponised") > 0,
  },
  {
    lane: "shopfront-clone-netcraft-issue",
    feature: "shopfront_clone_netcraft_issue",
    operation: "issue_report",
    expectEvery: 26 * H, // daily 11:00
    consecutive: 1,
    shape: "every uuid permanently rejected (the #1157 'not yet' shape)",
    silentZero: (m) =>
      num(m, "uuids") > 0 && num(m, "permanentRejects") >= num(m, "uuids"),
    braked: (m) => m.braked === true,
  },
  {
    lane: "shopfront-clone-netcraft-resubmit",
    feature: "shopfront_clone_netcraft_resubmit",
    operation: "resubmit_bulk",
    expectEvery: 26 * H,
    consecutive: 1,
    shape: "candidates>0 ∧ marked=0 ∧ deferred=0",
    silentZero: (m) =>
      num(m, "candidates") > 0 &&
      num(m, "marked") === 0 &&
      num(m, "deferred") === 0,
  },
  {
    lane: "shopfront-clone-netcraft-reconcile",
    feature: "shopfront_clone_netcraft_reconcile",
    operation: "lifecycle_reconcile",
    expectEvery: 26 * H,
    consecutive: 3,
    shape: "uuids=0 on every recent run",
    silentZero: (m) => num(m, "uuids") === 0,
  },
  {
    lane: "shopfront-clone-nrd-daily-ingest",
    feature: "shopfront_clone_watch",
    operation: "nrd_daily_ingest",
    expectEvery: 26 * H,
    consecutive: 1,
    shape: "domains_scanned=0, or every chunk failed",
    silentZero: (m) =>
      num(m, "domains_scanned") === 0 ||
      (num(m, "total_chunks") > 0 &&
        num(m, "failed_chunks") >= num(m, "total_chunks")),
  },
  {
    lane: "shopfront-clone-feed-platform",
    feature: "clone_watch_feed_entity",
    operation: "feed_batch",
    // Event-driven (per weaponisation); absence is not a signal here.
    expectEvery: Number.POSITIVE_INFINITY,
    consecutive: 1,
    shape: "pool>0 ∧ written=0",
    silentZero: (m) => num(m, "pool") > 0 && num(m, "written") === 0,
  },
  {
    lane: "shopfront-clone-haiku-preclassify",
    feature: "shopfront_clone_preclassify",
    operation: "classify",
    // Per-alert rows; the only readable signal is that none arrived.
    expectEvery: 26 * H,
    consecutive: 1,
    shape: "no classify row in 26h",
    silentZero: () => false,
  },
];

/**
 * Evaluate every lane in LANE_SHAPES against the rows the digest fetched.
 * `rows` may be in any order and may include features not in the roster.
 */
export function classifyLaneHealth(
  rows: LaneCostRow[],
  now: number = Date.now(),
): LaneProblem[] {
  const problems: LaneProblem[] = [];

  for (const shape of LANE_SHAPES) {
    const mine = rows
      .filter(
        (r) => r.feature === shape.feature && r.operation === shape.operation,
      )
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

    const latest = mine[0];
    if (!latest) {
      if (Number.isFinite(shape.expectEvery)) {
        problems.push({
          lane: shape.lane,
          kind: "absent",
          detail: `no ${shape.feature}/${shape.operation} row in the window`,
        });
      }
      continue;
    }

    const ageMs = now - Date.parse(latest.created_at);
    if (Number.isFinite(shape.expectEvery) && ageMs > shape.expectEvery) {
      problems.push({
        lane: shape.lane,
        kind: "absent",
        detail: `last row ${Math.round(ageMs / H)}h ago (expected every ${Math.round(shape.expectEvery / H)}h)`,
      });
      continue;
    }

    const latestMeta = metaOf(latest);
    if (shape.braked?.(latestMeta)) {
      problems.push({
        lane: shape.lane,
        kind: "braked",
        detail: "latest run reports braked=true",
      });
      continue;
    }

    const recent = mine.slice(0, shape.consecutive);
    if (
      recent.length >= shape.consecutive &&
      recent.every((r) => shape.silentZero(metaOf(r)))
    ) {
      problems.push({
        lane: shape.lane,
        kind: "silent_zero",
        detail: `${recent.length} consecutive run${recent.length === 1 ? "" : "s"}: ${shape.shape}`,
      });
    }
  }

  return problems;
}
