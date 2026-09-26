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
 * Coverage is enforced, not described: __tests__/laneRoster.test.ts fails if a
 * clone-watch function is neither in the roster, an absence watch, nor in its
 * EXEMPT map with a reason (ADR-0025 amendment 2026-09-23). Preclassify writes
 * per-alert vendor rows, not a per-run outcome, and is watched for absence.
 */

import {
  LANES,
  type LaneId,
  type LaneOutcome,
} from "@askarthur/scam-engine/lane-outcome";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { expectEveryFromCrons } from "@/lib/cron-cadence";

export type LaneProblemKind =
  /** No row inside the lane's expected window. */
  | "absent"
  /** Rows arrive on schedule and every one is a no-op. */
  | "silent_zero"
  /** `feature_brakes` says the lane is paused right now. */
  | "braked"
  /** `feature_brakes` could not be read, so no lane's brake could be judged. */
  | "brake_unknown"
  /** Every recent run was stopped by the vendor's quota (e.g. urlscan 429s). */
  | "quota_exhausted"
  /** Every recent run was held by the Lane's OWN per-run cap, and the backlog
   *  it leaves is not draining — demand has outgrown the cap (#1231). */
  | "cap_bound";

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

/** A featureFlags key whose value is a boolean — what a Lane's gate is made of. */
export type LaneFlag = {
  [K in keyof typeof featureFlags]: (typeof featureFlags)[K] extends boolean
    ? K
    : never;
}[keyof typeof featureFlags];

interface Shape<L extends LaneId> {
  /**
   * The Lane's cron triggers — the ONE copy. The Lane's createFunction reads
   * them through `laneCrons()`, and `expectEvery` is derived from them, so the
   * schedule and the health window cannot drift apart. A PARKED Lane (cron
   * removed while its flag is dark) keeps its restore value here and its
   * trigger does not read it.
   */
  crons?: readonly string[];
  /**
   * PARKED (#1230): the Lane does nothing on its schedule today, so it runs
   * only on its manual-trigger event. The value says why. `laneCrons()`
   * returns no schedule and the digest expects no row, so a parked Lane never
   * pages "absent" and burns no Inngest runs. Un-parking is deleting this one
   * field — `crons` keeps the schedule to restore (one declaration, as ever).
   */
  parked?: string;
  /**
   * ISO instant before which a MISSING row is not `absent` — a new Lane whose
   * first scheduled run is still ahead (a monthly one would otherwise page
   * "no row in the window" every day until it first fires). Only the
   * never-written case is excused; a stale row after it is judged as usual.
   */
  firstExpectedAt?: string;
  /**
   * Longest healthy gap between rows, in ms — ONLY where `crons` cannot give
   * it: event-driven Lanes (`POSITIVE_INFINITY`) and monthly ones (the cron
   * parser refuses a day-of-month on purpose). Otherwise derived.
   */
  expectEvery?: number;
  /**
   * The Lane's flag gate — the ONE copy. The Lane body calls `laneGate()`,
   * and the digest skips the Lane while any flag is off (a flag-off Lane
   * writes nothing by design, so it would otherwise page "absent" daily).
   * Omitted = always expected to run. Non-flag conditions (an API key, a
   * test-mode bypass) stay in the body.
   */
  flags?: readonly LaneFlag[];
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
  /**
   * A vendor quota wall that PERSISTS. `silentZero` deliberately excludes
   * quota-limited runs (a 429 day is not a broken lane), which left a
   * permanent quota loss — a downgraded key, a plan change — paging nowhere:
   * every run all-429, rows never stamped, nothing silent_zero
   * (review 2026-09-24). Judged over its OWN depth, longer than
   * `consecutive`, so one bad quota day stays quiet.
   */
  quotaExhausted?: { consecutive: number; test: (o: Seen<L>) => boolean };
  /**
   * A per-run cap that binds PERSISTENTLY (#1231). Every capped clone-watch
   * Lane used to hit its cap silently — retrieve at 40/40 on 10 of 12 runs,
   * the enricher at 60/60 while its backlog aged out of the window — because
   * a full batch reads as success. Fires when the latest `consecutive` rows
   * all hit the cap AND, where the Lane reports a backlog, it is not
   * shrinking across them (a backlog draining at the cap is the cap working).
   * Not declared for lifecycle-recheck (its demand is structurally above the
   * urlscan quota, so it would page forever; its gap is `due_total`, #1229)
   * nor netcraft resubmit (a precision cap). Evaluated AFTER silent_zero, so
   * it can never mask a lane that is doing nothing.
   */
  capBound?: {
    consecutive: number;
    test: (o: Seen<L>) => boolean;
    backlog?: (o: Seen<L>) => number | null;
  };
}

const H = 3_600_000;

/** netcraft-auto runs both sub-lanes in one function, so they share a schedule. */
const NETCRAFT_AUTO_CRONS = ["0 13 * * *"] as const;

/**
 * One shape per roster Lane. Predicates are written against the metadata each
 * Lane actually writes (`LaneOutcome`); docs/ops/clone-watch-config.md §4b
 * lists a sample row per lane.
 */
export const LANE_SHAPES: { [L in LaneId]: Shape<L> } = {
  "shopfront-clone-lifecycle-recheck": {
    crons: ["30 */6 * * *"],
    flags: ["shopfrontCloneRecheck", "shopfrontCloneUrlscan"],
    consecutive: 2,
    shape:
      "pool>0 ∧ rechecked=0 ∧ dns_unchanged=0 (not quota), or nothing submitted while real submits failed",
    // One rule for both urlscan lanes: a run with ZERO successful submits and
    // at least one GENUINE submit failure is broken, whatever else happened
    // (429s and DNS skips don't excuse it). A pure-quota run (failures 0) is
    // left to quotaExhausted. An all-rate-limited run rechecks nothing by
    // design (rows left unstamped to retry first). Rows before 2026-09-24
    // carry no rate_limited (n() → 0) and judge as before.
    // v334: a run whose whole DNS slice read UNCHANGED urlscans nothing by
    // design — it stamped every row it read, which is the lane working. It is
    // silent only if it also stamped nothing (dns_unchanged = 0). Rows before
    // v334 carry no dns_unchanged (n() → 0) and judge as before.
    silentZero: (o) =>
      (n(o, "pool") > 0 &&
        n(o, "rechecked") === 0 &&
        n(o, "rate_limited") === 0 &&
        n(o, "dns_unchanged") === 0) ||
      (n(o, "rechecked") > 0 &&
        n(o, "submitted") === 0 &&
        n(o, "submit_failed") > 0),

    // 4 runs ≈ 24h of the 6-hourly cadence with nothing submitted and urlscan
    // refusing on quota.
    quotaExhausted: {
      consecutive: 4,
      // Pure quota only: a run that also had genuine submit failures is a
      // broken lane, not a quota wall, and must reach silent_zero instead.
      test: (o) =>
        n(o, "rate_limited") > 0 &&
        n(o, "submitted") === 0 &&
        n(o, "submit_failed") === 0,
    },
  },
  "shopfront-clone-urlscan-submit": {
    crons: ["0 9 * * *"],
    flags: ["shopfrontCloneUrlscan"],
    consecutive: 1,
    capBound: {
      consecutive: 3,
      test: (o) => o.cap_reached === true,
    },
    shape: "units>0 ∧ submitted=0 ∧ (rate_limited=0 ∨ submit_failed>0)",
    // Same rule as recheck: nothing submitted while genuine submits failed
    // pages regardless of 429s; nothing submitted AND nothing refused on quota
    // (the Sep 12–16 shape) pages too. Pure quota → quotaExhausted.
    // DNS-precheck skips (no_host / SERVFAIL) are not work: a day whose whole
    // batch was dead domains submitted nothing correctly (2026-09-25).
    // Not-a-clone audit samples (v330) are deliberately OUTSIDE every field
    // read here: the lane writes them as a separate audit_* tally and `units`
    // counts regular rows only, so a day whose batch was only DNS-dead audit
    // samples reads units=0 — quiet, not silent. Guarded in
    // __tests__/notACloneAuditLane.test.ts.
    silentZero: (o) =>
      n(o, "units") - n(o, "dns_skipped") - n(o, "dns_servfail") > 0 &&
      n(o, "submitted") === 0 &&
      (n(o, "rate_limited") === 0 || n(o, "submit_failed") > 0),

    // 2 daily runs with nothing submitted and urlscan refusing on quota.
    quotaExhausted: {
      consecutive: 2,
      // Pure quota only: a run that also had genuine submit failures is a
      // broken lane, not a quota wall, and must reach silent_zero instead.
      test: (o) =>
        n(o, "rate_limited") > 0 &&
        n(o, "submitted") === 0 &&
        n(o, "submit_failed") === 0,
    },
  },
  "shopfront-clone-urlscan-retrieve": {
    crons: ["10 3,9,12,15,21 * * *"],
    flags: ["shopfrontCloneUrlscan"],
    consecutive: 3,
    capBound: {
      consecutive: 5,
      test: (o) => o.cap_reached === true,
    },
    shape: "classified=0 while still_pending>0, or unnotified_weaponised>0",
    silentZero: (o) =>
      (n(o, "classified") === 0 && n(o, "still_pending") > 0) ||
      n(o, "unnotified_weaponised") > 0,
  },
  "shopfront-clone-netcraft-issue": {
    crons: ["0 11 * * *"],
    flags: ["shopfrontCloneOutreach", "cloneNetcraftIssue"],
    consecutive: 1,
    shape: "every uuid permanently rejected (the #1157 'not yet' shape)",
    silentZero: (o) =>
      n(o, "uuids") > 0 && n(o, "permanentRejects") >= n(o, "uuids"),
  },
  "shopfront-clone-netcraft-auto/resubmit": {
    crons: NETCRAFT_AUTO_CRONS,
    flags: ["cloneNetcraftResubmit", "shopfrontCloneSubmitNetcraft", "shopfrontCloneOutreach"],
    consecutive: 1,
    // No capBound: a PRECISION cap (each report goes out in Ask Arthur's
    // name), not capacity — hitting it is the cap doing its job. The row still
    // carries cap / cap_reached for the record.
    shape: "candidates>0 ∧ marked=0 ∧ deferred=0",
    silentZero: (o) =>
      n(o, "candidates") > 0 && n(o, "marked") === 0 && n(o, "deferred") === 0,
  },
  "shopfront-clone-netcraft-reconcile": {
    crons: ["0 10 * * *", "0 22 * * *"],
    flags: ["shopfrontCloneOutreach", "cloneLifecycleReconcile"],
    consecutive: 1,
    capBound: {
      consecutive: 4,
      test: (o) => o.cap_reached === true,
    },
    // Absence only (2026-09-24). "uuids=0 three runs running" was written when
    // every submission was re-read daily; since v316's unchanged-verdict
    // backoff (72 h) and v284's ~1 submission/day, an empty worklist is the
    // NORMAL quiet state (day 1: 10:00 run found 0, correctly) and the check
    // would have paged every few days. The failure it stood in for — a broken
    // worklist read — now throws and writes a Lane error row (PR B, #1188),
    // which the digest reports directly; absence still catches a dead Lane.
    //
    // v329 (#1234 review): the weaponised outcome steps soft-fail by design —
    // they must not cost the Netcraft half its Outcome Row — so their failure
    // is a FIELD, not an error row. Without this predicate a missing v329 or a
    // broken RPC read as a healthy lane forever. An empty Netcraft worklist is
    // still quiet; these are not.
    shape:
      "liveness_error or vendor_gap_error present, or liveness_due > 0 with liveness_checked = 0",
    silentZero: (o) =>
      typeof o.liveness_error === "string" ||
      typeof o.vendor_gap_error === "string" ||
      (n(o, "liveness_due") > 0 && o.liveness_checked === 0),
  },
  "shopfront-nrd-daily-ingest": {
    crons: ["30 8 * * *"],
    flags: ["shopfrontCloneWatch"],
    consecutive: 1,
    shape: "domains_scanned=0, or every chunk failed",
    silentZero: (o) =>
      n(o, "domains_scanned") === 0 ||
      (n(o, "total_chunks") > 0 &&
        n(o, "failed_chunks") >= n(o, "total_chunks")),
  },
  "shopfront-clone-netcraft-auto/auto": {
    crons: NETCRAFT_AUTO_CRONS,
    flags: ["shopfrontCloneNetcraftAuto", "shopfrontCloneSubmitNetcraft", "shopfrontCloneOutreach"],
    consecutive: 1,
    shape: "candidates>0 ∧ marked=0",
    silentZero: (o) => n(o, "candidates") > 0 && n(o, "marked") === 0,
  },
  "clone-watch-enrich-attribution": {
    crons: ["30 13 * * *"],
    // Two runs: a one-off RDAP outage should not page; six silent days
    // (2026-09-11..16, found by the 09-22 audit) must.
    flags: ["cloneWatchAttribution"],
    consecutive: 2,
    capBound: {
      consecutive: 3,
      test: (o) => o.cap_reached === true,
      backlog: (o) => (typeof o.backlog === "number" ? o.backlog : null),
    },
    // #1253, two more disjuncts — the re-offer is the only path that ever
    // gives a deferred-WHOIS row a registrar, so a stalled one is the same
    // silent loss the issue found:
    //   - due rows, none re-offered;
    //   - the due select FAILED (`whois_reoffer_due` written as null — not
    //     absent, which is a row from before #1253). Across `consecutive` (2)
    //     daily runs, a broken select pages instead of reading as "none due".
    shape:
      "(pending>0 ∧ enriched=0) ∨ (whois_reoffer_due>0 ∧ whois_reoffered=0) ∨ whois_reoffer_due=null",
    silentZero: (o) =>
      (n(o, "pending") > 0 && n(o, "enriched") === 0) ||
      (n(o, "whois_reoffer_due") > 0 && n(o, "whois_reoffered") === 0) ||
      o.whois_reoffer_due === null,
  },
  "shopfront-clone-notify-brand-prepare": {
    crons: ["30 9 * * *"],
    parked:
      "no brand contact until the #1237 readiness gate holds (#1227); 100% no_unbatched_rows",
    flags: ["shopfrontCloneOutreach", "shopfrontCloneNotifyBrand"],
    consecutive: 1,
    shape: "every prepared group failed",
    silentZero: (o) =>
      n(o, "groups_failed") > 0 && n(o, "batches_prepared") === 0,
  },
  "shopfront-clone-reemergence-monitor": {
    crons: ["45 6 * * *"],
    // PARKED (event-only, 2026-09-24): the cron is removed while dark. If this
    // gate turns on without the cron restored, the lane pages `absent` — by
    // design; clone-watch-config.md "Flipping a PARKED lane ON".
    flags: ["cloneEnforcement", "cloneReemergenceMonitor"],
    consecutive: 1,
    shape: "(absence only)",
    silentZero: () => false,
  },
  "shopfront-clone-weekly-digest": {
    crons: ["0 10 * * 0"],
    // PARKED (event-only, 2026-09-24): the cron is removed while dark. If this
    // gate turns on without the cron restored, the lane pages `absent` — by
    // design; clone-watch-config.md "Flipping a PARKED lane ON".
    flags: ["shopfrontCloneOutreach", "shopfrontCloneWeeklyDigest"],
    consecutive: 1,
    shape: "(absence only)",
    silentZero: () => false,
  },
  "shopfront-clone-enforcement-execute": {
    crons: ["15 */3 * * *"],
    // PARKED (event-only, 2026-09-24): the cron is removed while dark. If this
    // gate turns on without the cron restored, the lane pages `absent` — by
    // design; clone-watch-config.md "Flipping a PARKED lane ON".
    flags: ["cloneEnforcement", "cloneEnforceAutoBlocklist"],
    consecutive: 1,
    // A fully-deduped batch legitimately enqueues 0, so there is no honest
    // silent-zero shape here; the watch is absence (the lane stopped running).
    shape: "(absence only)",
    silentZero: () => false,
  },
  "shopfront-clone-haiku-preclassify": {
    // Event-driven (the daily fan-out), so absence is watched by the
    // ABSENCE_WATCHES `classify` stream below, which proves vendor calls
    // happen. This row judges the BATCH: alerts in, nothing classified —
    // or the auto-park (#1230, moved in from the retired auto-triage) failed.
    // The park is fail-soft so a batch never fails over it; this is what
    // stops fail-soft from being silent (the alerts would just stay pending).
    expectEvery: Number.POSITIVE_INFINITY,
    flags: ["shopfrontClonePreclassify"],
    consecutive: 1,
    shape: "alerts>0 ∧ classified=0, or auto_park_failed",
    silentZero: (o) =>
      (n(o, "alerts") > 0 && n(o, "classified") === 0) ||
      o.auto_park_failed === true,
  },
  "clone-watch-report-summary": {
    // Monthly (1st, 11:00). Absence is THE signal for a monthly Lane: the
    // 2026-09-01 stewardship run was finish-cancelled with no retry and no
    // row, and nothing noticed that August's brand reports never existed.
    crons: ["0 11 1 * *"],
    // Monthly: the cron parser refuses day-of-month, so the window is explicit.
    expectEvery: 32 * 24 * H,
    consecutive: 1,
    shape: "clones found but no store rows written",
    silentZero: (o) => n(o, "total") > 0 && n(o, "brand_rows") === 0,
  },
  "clone-watch-month-end-liveness": {
    // Monthly (1st, 01:00) — ten hours before the summary that reads it. An
    // absent row here IS the "active_stock_eom NULL this month" explanation.
    crons: ["0 1 1 * *"],
    firstExpectedAt: "2026-10-01T02:00:00Z",
    // Monthly: the cron parser refuses day-of-month, so the window is explicit.
    expectEvery: 32 * 24 * H,
    consecutive: 1,
    // `probed` excludes unverified rows, so a resolver-wide failure pages.
    shape: "active stock > 0 but no DNS verdict",
    silentZero: (o) => n(o, "stock") > 0 && n(o, "probed") === 0,
  },
  "report-brand-stewardship": {
    expectEvery: 32 * 24 * H, // monthly, after the store is written
    flags: ["brandStewardshipReport"],
    consecutive: 1,
    shape: "every report row failed to write",
    silentZero: (o) => n(o, "failed") > 0 && n(o, "prepared") === 0,
  },
  "shopfront-clone-fp-cluster-digest": {
    crons: ["30 9 * * 0"],
    parked: "no FP-cluster input since 2026-09-04; triage is paused with brand contact (#1227)",
    flags: ["shopfrontCloneWatch"],
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
 * The Lane's cron triggers, for its createFunction. Throws for a Lane that
 * declares none — an event-driven Lane asking for a schedule is a wiring bug.
 */
export function laneCrons(lane: LaneId): Array<{ cron: string }> {
  if (LANE_SHAPES[lane].parked) return [];
  const crons = LANE_SHAPES[lane].crons;
  if (!crons?.length) throw new Error(`laneCrons: ${lane} declares no crons`);
  return crons.map((cron) => ({ cron }));
}

/** Longest healthy gap between the Lane's rows: explicit, else from its crons. */
export function laneExpectEvery(lane: LaneId): number {
  const shape = LANE_SHAPES[lane];
  if (shape.parked) return Number.POSITIVE_INFINITY;
  if (shape.expectEvery !== undefined) return shape.expectEvery;
  if (shape.crons?.length) return expectEveryFromCrons(shape.crons);
  throw new Error(`laneExpectEvery: ${lane} declares neither crons nor expectEvery`);
}

export type LaneGate = { ok: true } | { ok: false; reason: string };

/**
 * The Lane's flag gate, evaluated now. Lane bodies return
 * `{ skipped: true, reason }` on `ok: false`; the digest skips the Lane.
 * `reason` names the first flag that is off.
 */
export function laneGate(lane: LaneId): LaneGate {
  for (const flag of LANE_SHAPES[lane].flags ?? []) {
    if (!featureFlags[flag]) return { ok: false, reason: `${flag} disabled` };
  }
  return { ok: true };
}

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

/**
 * What the digest must fetch so every lane can be judged: one window for the
 * frequent lanes (enough for their consecutive-run depth) and one wide enough
 * for the weekly/monthly lanes' `expectEvery`. A single 72 h window made every
 * lane with a longer cadence read "absent" most days (review 2026-09-23) — a
 * false page trains people to ignore the real ones. Derived from the shapes,
 * so a new long-cadence lane cannot silently fall outside the fetch; pinned by
 * laneHealth.test.ts.
 */
export const SHORT_FETCH_WINDOW_MS = 72 * H;

export function laneFetchPlan(): Array<{ features: string[]; windowMs: number }> {
  const short = new Set<string>(ABSENCE_WATCHES.map((w) => w.feature));
  const long = new Set<string>();
  let longWindow = 0;
  for (const lane of Object.keys(LANE_SHAPES) as LaneId[]) {
    const every = laneExpectEvery(lane);
    const feature = LANES[lane].feature;
    if (Number.isFinite(every) && every > SHORT_FETCH_WINDOW_MS) {
      long.add(feature);
      longWindow = Math.max(longWindow, every + 24 * H);
    } else {
      short.add(feature);
    }
  }
  const plan = [{ features: [...short], windowMs: SHORT_FETCH_WINDOW_MS }];
  if (long.size > 0) plan.push({ features: [...long], windowMs: longWindow });
  return plan;
}

/** Number of lanes evaluated — the digest's proof-of-life counter. */
export const LANES_CHECKED =
  Object.keys(LANE_SHAPES).length + ABSENCE_WATCHES.length;

export interface LaneHealthInput {
  now?: number;
  /**
   * `feature_brakes.feature` → `paused_until` ISO, for the roster's brake keys;
   * `"unreadable"` when the read failed. The third state is reported, never
   * collapsed into "not braked" (brakeState's rule, ADR-0025 amendment).
   */
  brakes?: Record<string, string | null | undefined> | "unreadable";
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

/** Depth of the quota wall when the most recent `quotaExhausted.consecutive`
 *  rows all hit it, else null. */
function quotaExhaustedRuns<L extends LaneId>(
  lane: L,
  mine: LaneCostRow[],
): number | null {
  const q = (LANE_SHAPES[lane] as Shape<L>).quotaExhausted;
  if (!q) return null;
  const recent = mine.slice(0, q.consecutive);
  if (recent.length < q.consecutive) return null;
  return recent.every((r) => q.test(seenOf<L>(r))) ? recent.length : null;
}

/** Depth of a persistent cap bind (see `Shape.capBound`), else null. */
function capBoundRuns<L extends LaneId>(
  lane: L,
  mine: LaneCostRow[],
): number | null {
  const c = (LANE_SHAPES[lane] as Shape<L>).capBound;
  if (!c) return null;
  const recent = mine.slice(0, c.consecutive);
  if (recent.length < c.consecutive) return null;
  const seen = recent.map((r) => seenOf<L>(r));
  if (!seen.every((o) => c.test(o))) return null;
  if (c.backlog) {
    const newest = c.backlog(seen[0]!);
    const oldest = c.backlog(seen[seen.length - 1]!);
    if (newest !== null && oldest !== null && newest < oldest) return null;
  }
  return recent.length;
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
  firstExpectedAt?: string,
): LaneProblem | null {
  if (!Number.isFinite(expectEvery)) return null;
  if (!latest) {
    if (firstExpectedAt && now < Date.parse(firstExpectedAt)) return null;
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
  const brakesUnreadable = input.brakes === "unreadable";
  const brakes: Record<string, string | null | undefined> =
    input.brakes === "unreadable" ? {} : (input.brakes ?? {});
  const problems: LaneProblem[] = [];
  if (brakesUnreadable) {
    // One line, not one per lane: the lanes below are still judged (as
    // unbraked), so a braked lane may read "absent" — this line says why.
    problems.push({
      lane: "feature_brakes",
      kind: "brake_unknown",
      detail:
        "brake state unreadable — brake-gated lanes judged as if unbraked (an 'absent' below may be a brake)",
    });
  }

  for (const lane of Object.keys(LANE_SHAPES) as LaneId[]) {
    const key = LANES[lane];
    const shape = LANE_SHAPES[lane];
    if (!laneGate(lane).ok) continue;
    const mine = rowsFor(rows, key.feature, key.operation);

    // Brake FIRST: a braked lane skips without writing a row, so judging
    // absence first reported every braked lane as "absent" — the wrong page.
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

    const absent = absence(
      lane,
      key.feature,
      key.operation,
      mine[0],
      laneExpectEvery(lane),
      now,
      shape.firstExpectedAt,
    );
    if (absent) {
      problems.push(absent);
      continue;
    }

    const quota = quotaExhaustedRuns(lane, mine);
    if (quota !== null) {
      problems.push({
        lane,
        kind: "quota_exhausted",
        detail: `vendor quota exhausted ${quota} consecutive runs (nothing submitted)`,
      });
      continue;
    }

    const recent = mine.slice(0, shape.consecutive);
    if (recent.length >= shape.consecutive && allSilentZero(lane, recent)) {
      problems.push({
        lane,
        kind: "silent_zero",
        detail: `${recent.length} consecutive run${recent.length === 1 ? "" : "s"}: ${shape.shape}`,
      });
      // silent_zero outranks cap_bound: a lane doing nothing (or holding an
      // unnotified weaponised alert) is the page; its cap is secondary.
      continue;
    }

    // Last: a capacity advisory, never allowed to mask a failure above.
    const capped = capBoundRuns(lane, mine);
    if (capped !== null) {
      problems.push({
        lane,
        kind: "cap_bound",
        detail: shape.capBound?.backlog
          ? `per-run cap hit ${capped} consecutive runs and the backlog is not draining — size the cap from demand`
          : `per-run cap hit ${capped} consecutive runs — rows are being left for the next run; size the cap from demand`,
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
