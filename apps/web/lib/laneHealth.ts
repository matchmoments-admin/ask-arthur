/**
 * Clone-watch Lane health — the "ran, did nothing, reported ok:true" detector
 * (#1145, map #1143). The decision half of health-digest's fourth check, the
 * same seam as feedHealth.ts: rows in, problems out, no I/O.
 *
 * Twice the feature went to zero while every function returned `ok: true` and
 * every cost row was honest: the recheck lane logged `rechecked 0 /
 * submit_failed 50` daily from Sep 9 (#1127's worklist starvation) and the
 * submit lane logged `units 75, submitted 0, failed 0, rate_limited 0` daily
 * from Sep 12 (#1124's spanning budget expiring at index 0). Neither shape
 * alerted anywhere; both were found by a human reading cost_telemetry a week
 * later. This module is the table of those shapes, one per Lane, evaluated
 * against the Lane's most recent Outcome Rows.
 *
 * The roster and the outcome shapes are NOT declared here. They live in
 * `@askarthur/scam-engine/lane-outcome` (`LANES` + `LaneOutcome`), which is
 * also the only writer — so a predicate here is typed against the keys the
 * Lane actually writes, and a misspelt key is a compile error on whichever
 * side drifts instead of a silent 0. `LANE_SHAPES` is a mapped type over
 * `LaneId`: adding a Lane to the roster without a shape does not compile
 * (proof of life enforced by the type, not by a length assertion).
 *
 * Two rules from the feed-health incident carry over:
 *
 *   - Start from the ROSTER, not from what is present in the log. A Lane that
 *     stops writing drops out of any query grouped by what is there, so the
 *     harder it failed the more certainly it was invisible. A Lane with no
 *     row inside its `expectEvery` window is `absent`. Every roster Lane
 *     writes one Outcome Row per run including its quiet-day path (#1166), so
 *     absence is a real signal; skip-paths (flag off, brake, cooldown, no DB)
 *     write nothing on purpose — a disabled Lane SHOULD read as absent.
 *   - Never gate proof-of-life on "nothing to report" (#884). The digest
 *     records lanes_checked whether or not anything fired.
 *
 * Brake state is an INPUT (`feature_brakes.paused_until`), not inferred from
 * the latest row: after an operator clears a brake the row still says
 * `braked:true` until the next run overwrites it, which read as a live brake
 * for up to a day (the Sep 16–17 case).
 *
 * Lanes with NO per-run Outcome Row (notify-brand, notify-weaponised,
 * enforcement-*, reemergence, enrich-attribution, report-summary,
 * the digests, scan-one) cannot be watched from telemetry and are not listed —
 * listing them would be a guard that reads as protection. They are the
 * graduated ticket "every lane logs one outcome row per run". Preclassify
 * writes per-alert Claude rows, not a per-run outcome, and is watched for
 * absence only.
 */

import {
  LANES,
  type LaneId,
  type LaneOutcome,
} from "@askarthur/scam-engine/lane-outcome";
import { featureFlags } from "@askarthur/utils/feature-flags";

export type LaneProblemKind =
  /** No row inside the lane's expected window. */
  | "absent"
  /** Rows arrive on schedule and every one is a no-op. */
  | "silent_zero"
  /** `feature_brakes` says the lane is paused right now. */
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

/** What a predicate sees: the Lane's typed outcome plus the row's `units`. */
type Seen<L extends LaneId> = Partial<LaneOutcome[L]> & { units: number };

/**
 * Read a numeric key, treating missing / non-numeric as 0. The key is typed
 * against the Lane's outcome so it cannot be misspelt; the 0 default keeps a
 * Lane that STOPS logging a field reading as zero — loud, not silent.
 */
const n = <L extends LaneId>(o: Seen<L>, k: keyof Seen<L> & string): number => {
  const v = (o as Record<string, unknown>)[k];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

interface Shape<L extends LaneId> {
  /** Longest gap between rows that is still healthy, in ms. */
  expectEvery: number;
  /**
   * The Lane's own gate. A flag-off Lane writes nothing by design (skip paths
   * are silent), so without this a disabled Lane would page "absent" every
   * day. Evaluated at digest time; omitted = always expected to run.
   */
  enabled?: () => boolean;
  /**
   * How many consecutive most-recent rows must ALL be zero before it counts.
   * 1 = one bad run pages (daily lanes); 3 = tolerate two quiet runs (lanes
   * that run several times a day and legitimately find nothing sometimes).
   */
  consecutive: number;
  /** Short description of the shape for the digest line. */
  shape: string;
  /** True when this row is "did nothing while reporting success". */
  silentZero: (o: Seen<L>) => boolean;
}

const H = 3_600_000;

/**
 * One shape per roster Lane. Predicates are written against the metadata each
 * Lane actually writes (`LaneOutcome`); docs/ops/clone-watch-config.md §4b
 * lists a sample row per lane.
 */
export const LANE_SHAPES: { [L in LaneId]: Shape<L> } = {
  "shopfront-clone-lifecycle-recheck": {
    expectEvery: 9 * H, // 6h cron + slack
    consecutive: 2,
    shape: "pool>0 ∧ rechecked=0, or every recheck failed to submit",
    silentZero: (o) =>
      (n(o, "pool") > 0 && n(o, "rechecked") === 0) ||
      (n(o, "rechecked") > 0 &&
        n(o, "submitted") === 0 &&
        n(o, "submit_failed") >= n(o, "rechecked")),
  },
  "shopfront-clone-urlscan-submit": {
    expectEvery: 26 * H, // daily 09:00
    consecutive: 1,
    shape: "units>0 ∧ submitted=0 ∧ rate_limited=0",
    silentZero: (o) =>
      n(o, "units") > 0 &&
      n(o, "submitted") === 0 &&
      n(o, "rate_limited") === 0,
  },
  "shopfront-clone-urlscan-retrieve": {
    expectEvery: 9 * H,
    consecutive: 3,
    shape: "classified=0 while still_pending>0, or unnotified_weaponised>0",
    silentZero: (o) =>
      (n(o, "classified") === 0 && n(o, "still_pending") > 0) ||
      n(o, "unnotified_weaponised") > 0,
  },
  "shopfront-clone-netcraft-issue": {
    expectEvery: 26 * H, // daily 11:00
    consecutive: 1,
    shape: "every uuid permanently rejected (the #1157 'not yet' shape)",
    silentZero: (o) =>
      n(o, "uuids") > 0 && n(o, "permanentRejects") >= n(o, "uuids"),
  },
  "shopfront-clone-netcraft-auto/resubmit": {
    expectEvery: 26 * H,
    consecutive: 1,
    shape: "candidates>0 ∧ marked=0 ∧ deferred=0",
    silentZero: (o) =>
      n(o, "candidates") > 0 && n(o, "marked") === 0 && n(o, "deferred") === 0,
  },
  "shopfront-clone-netcraft-reconcile": {
    expectEvery: 26 * H,
    consecutive: 3,
    shape: "uuids=0 on every recent run",
    silentZero: (o) => n(o, "uuids") === 0,
  },
  "shopfront-nrd-daily-ingest": {
    expectEvery: 26 * H,
    consecutive: 1,
    shape: "domains_scanned=0, or every chunk failed",
    silentZero: (o) =>
      n(o, "domains_scanned") === 0 ||
      (n(o, "total_chunks") > 0 &&
        n(o, "failed_chunks") >= n(o, "total_chunks")),
  },
  "clone-watch-auto-triage": {
    expectEvery: 26 * H, // daily 13:00
    consecutive: 2,
    // The lane's job is to CLEAR the queue: park the weak tail, confirm the
    // strict one. A run that parks nothing while the pending queue is the
    // reason it exists is the silent-zero shape. `eligible>0 ∧ confirmed=0 ∧
    // offline=0` is the other: rows passed every gate and none was actioned
    // or explained by liveness — which is exactly how a mis-set
    // AUTO_CONFIRM_MIN_CONFIDENCE would present.
    shape: "eligible>0 ∧ confirmed=0 ∧ offline=0",
    silentZero: (o) =>
      n(o, "eligible") > 0 && n(o, "confirmed") === 0 && n(o, "offline") === 0,
  },
  "shopfront-clone-netcraft-auto/auto": {
    expectEvery: 26 * H, // daily 13:00
    enabled: () =>
      featureFlags.shopfrontCloneNetcraftAuto &&
      featureFlags.shopfrontCloneSubmitNetcraft &&
      featureFlags.shopfrontCloneOutreach,
    consecutive: 1,
    shape: "candidates>0 ∧ marked=0",
    silentZero: (o) => n(o, "candidates") > 0 && n(o, "marked") === 0,
  },
  "clone-watch-enrich-attribution": {
    expectEvery: 26 * H, // daily 13:30
    enabled: () => featureFlags.cloneWatchAttribution,
    // Two runs: a one-off RDAP outage should not page; six silent days
    // (2026-09-11..16, found by the 09-22 audit) must.
    consecutive: 2,
    shape: "pending>0 ∧ enriched=0",
    silentZero: (o) => n(o, "pending") > 0 && n(o, "enriched") === 0,
  },
  "shopfront-clone-notify-brand-prepare": {
    expectEvery: 26 * H, // daily 09:30
    enabled: () =>
      featureFlags.shopfrontCloneOutreach && featureFlags.shopfrontCloneNotifyBrand,
    consecutive: 1,
    shape: "every prepared group failed",
    silentZero: (o) =>
      n(o, "groups_failed") > 0 && n(o, "batches_prepared") === 0,
  },
  "shopfront-clone-reemergence-monitor": {
    expectEvery: 26 * H, // daily 06:45
    enabled: () =>
      featureFlags.cloneEnforcement && featureFlags.cloneReemergenceMonitor,
    consecutive: 1,
    shape: "(absence only)",
    silentZero: () => false,
  },
  "shopfront-clone-weekly-digest": {
    expectEvery: 8 * 24 * H, // Sundays 10:00
    enabled: () =>
      featureFlags.shopfrontCloneOutreach && featureFlags.shopfrontCloneWeeklyDigest,
    consecutive: 1,
    shape: "(absence only)",
    silentZero: () => false,
  },
  "shopfront-clone-enforcement-execute": {
    expectEvery: 4 * 3_600_000, // every 3h at :15
    enabled: () =>
      featureFlags.cloneEnforcement && featureFlags.cloneEnforceAutoBlocklist,
    consecutive: 1,
    // A fully-deduped batch legitimately enqueues 0, so there is no honest
    // silent-zero shape here; the watch is absence (the lane stopped running).
    shape: "(absence only)",
    silentZero: () => false,
  },
  "shopfront-clone-fp-cluster-digest": {
    expectEvery: 8 * 24 * H, // Sundays 09:30
    enabled: () => featureFlags.shopfrontCloneWatch,
    consecutive: 1,
    shape: "(absence only)",
    silentZero: () => false,
  },
  "shopfront-clone-feed-platform": {
    // Event-driven (per weaponisation); absence is not a signal here.
    expectEvery: Number.POSITIVE_INFINITY,
    consecutive: 1,
    shape: "pool>0 ∧ written=0",
    silentZero: (o) => n(o, "pool") > 0 && n(o, "written") === 0,
  },
};

/**
 * Absence-only watches: streams with no per-run outcome where the only
 * readable signal is that nothing arrived. Not in the roster because nothing
 * writes them through `recordLaneOutcome`.
 */
export const ABSENCE_WATCHES: ReadonlyArray<{
  lane: string;
  feature: string;
  operation: string;
  expectEvery: number;
}> = [
  {
    lane: "shopfront-clone-haiku-preclassify",
    feature: "shopfront_clone_preclassify",
    operation: "classify",
    expectEvery: 26 * H,
  },
  // ADR-0026: the Jev shadow tail has no watch of its own any more — in
  // primary mode Jev writes the pre-classifier's own `classify` rows above
  // (provider `typesafe`), so that watch covers it; in rollback mode the
  // shadow's silence is accepted as unattended (documented).
];

/** The `feature` values the digest must fetch to evaluate everything above. */
export const WATCHED_FEATURES: readonly string[] = Array.from(
  new Set([
    ...Object.values(LANES).map((l) => l.feature),
    ...ABSENCE_WATCHES.map((w) => w.feature),
  ]),
);

/** Number of lanes evaluated — the digest's proof-of-life counter. */
export const LANES_CHECKED =
  Object.keys(LANE_SHAPES).length + ABSENCE_WATCHES.length;

export interface LaneHealthInput {
  now?: number;
  /** `feature_brakes.feature` → `paused_until` ISO, for the roster's brake keys. */
  brakes?: Record<string, string | null | undefined>;
}

const seenOf = <L extends LaneId>(r: LaneCostRow): Seen<L> =>
  ({ units: r.units ?? 0, ...(r.metadata ?? {}) }) as Seen<L>;

/**
 * Generic so the predicate and the row view share one `L`; the mapped-type
 * lookup is a union until `L` is fixed, hence the one cast.
 */
function allSilentZero<L extends LaneId>(
  lane: L,
  recent: LaneCostRow[],
): boolean {
  const shape = LANE_SHAPES[lane] as Shape<L>;
  return recent.every((r) => shape.silentZero(seenOf<L>(r)));
}

function rowsFor(
  rows: LaneCostRow[],
  feature: string,
  operation: string,
): LaneCostRow[] {
  return rows
    .filter((r) => r.feature === feature && r.operation === operation)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** `absent` problem for a lane whose latest row is missing or too old, else null. */
function absence(
  lane: string,
  feature: string,
  operation: string,
  latest: LaneCostRow | undefined,
  expectEvery: number,
  now: number,
): LaneProblem | null {
  if (!Number.isFinite(expectEvery)) return null;
  if (!latest) {
    return {
      lane,
      kind: "absent",
      detail: `no ${feature}/${operation} row in the window`,
    };
  }
  const ageMs = now - Date.parse(latest.created_at);
  if (ageMs > expectEvery) {
    return {
      lane,
      kind: "absent",
      detail: `last row ${Math.round(ageMs / H)}h ago (expected every ${Math.round(expectEvery / H)}h)`,
    };
  }
  return null;
}

/**
 * Evaluate every roster Lane and absence watch against the rows the digest
 * fetched. `rows` may be in any order and may include features outside the
 * roster.
 */
export function classifyLaneHealth(
  rows: LaneCostRow[],
  input: LaneHealthInput = {},
): LaneProblem[] {
  const now = input.now ?? Date.now();
  const brakes = input.brakes ?? {};
  const problems: LaneProblem[] = [];

  for (const lane of Object.keys(LANE_SHAPES) as LaneId[]) {
    const key = LANES[lane];
    const shape = LANE_SHAPES[lane];
    if (shape.enabled && !shape.enabled()) continue;
    const mine = rowsFor(rows, key.feature, key.operation);

    const absent = absence(
      lane,
      key.feature,
      key.operation,
      mine[0],
      shape.expectEvery,
      now,
    );
    if (absent) {
      problems.push(absent);
      continue;
    }

    if ("brake" in key) {
      const pausedUntil = brakes[key.brake];
      if (pausedUntil && Date.parse(pausedUntil) > now) {
        problems.push({
          lane,
          kind: "braked",
          detail: `feature_brakes.${key.brake} paused until ${pausedUntil}`,
        });
        continue;
      }
    }

    const recent = mine.slice(0, shape.consecutive);
    if (recent.length >= shape.consecutive && allSilentZero(lane, recent)) {
      problems.push({
        lane,
        kind: "silent_zero",
        detail: `${recent.length} consecutive run${recent.length === 1 ? "" : "s"}: ${shape.shape}`,
      });
    }
  }

  for (const w of ABSENCE_WATCHES) {
    const absent = absence(
      w.lane,
      w.feature,
      w.operation,
      rowsFor(rows, w.feature, w.operation)[0],
      w.expectEvery,
      now,
    );
    if (absent) problems.push(absent);
  }

  return problems;
}
