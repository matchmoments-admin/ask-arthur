import { describe, expect, it } from "vitest";

import {
  LANES,
  type LaneId,
  type LaneOutcome,
} from "@askarthur/scam-engine/lane-outcome";
import {
  ABSENCE_WATCHES,
  classifyLaneHealth,
  LANE_SHAPES,
  LANES_CHECKED,
  type LaneCostRow,
} from "@/lib/laneHealth";

/**
 * The silent-zero detector (#1145) against the two incidents it exists for.
 * The fixtures are the REAL prod rows from cost_telemetry, not invented ones,
 * typed as the Lane's own `LaneOutcome` so a fixture missing a contract key
 * does not compile — the same guarantee the writer has.
 *
 * Go-red record:
 *   - "Sep 12–16 submit rows": the submit_batch predicate reads `units` from
 *     the row column. Delete the `units` merge in seenOf → this passes the
 *     incident as healthy (units reads 0 → predicate false).
 *   - "Sep 9–16 recheck rows": drop the `submit_failed >= rechecked` arm →
 *     the `rechecked 50 / submitted 0 / submit_failed 50` variant is healthy.
 *   - "absent by roster": remove the `!latest` branch → a lane that logged
 *     nothing at all is silently skipped (the feed-health failure class).
 *   - "quiet-day row": loosen the resubmit `deferred === 0` arm → the
 *     all-dead-with-failed-deferral shape passes as healthy.
 *   - "brake from feature_brakes": read `braked` from the row again → the
 *     cleared-brake case reports a stale `braked`.
 *   - "proof of life": every roster Lane has a shape (a compile error if not)
 *     AND the runtime count matches, so an emptied roster cannot pass as
 *     "no problems".
 */

const NOW = Date.parse("2026-09-17T06:30:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

/**
 * A row exactly as `recordLaneOutcome(lane, units, outcome)` writes it — the
 * same parameter type, so a fixture missing a contract key does not compile.
 * (Extras are allowed, as for the writer; the strict `keyof` guarantee is on
 * the READ side, in laneHealth.ts's predicates.)
 */
const outcomeRow = <L extends LaneId>(
  lane: L,
  hoursAgo: number,
  units: number,
  outcome: LaneOutcome[L] & Record<string, unknown>,
): LaneCostRow => ({
  feature: LANES[lane].feature,
  operation: LANES[lane].operation,
  created_at: ago(hoursAgo),
  units,
  metadata: outcome,
});

/** A row from a stream outside the roster (per-alert rows, other features). */
const rawRow = (
  feature: string,
  operation: string,
  hoursAgo: number,
  metadata: Record<string, unknown>,
  units: number | null = null,
): LaneCostRow => ({
  feature,
  operation,
  created_at: ago(hoursAgo),
  units,
  metadata,
});

/** Every lane healthy, as logged on 2026-09-17 after #1142/#1157. */
function healthyRows(): LaneCostRow[] {
  return [
    outcomeRow("shopfront-clone-lifecycle-recheck", 1, 50, {
      pool: 200,
      rechecked: 50,
      submitted: 47,
      submit_failed: 3,
    }),
    outcomeRow("shopfront-clone-lifecycle-recheck", 7, 50, {
      pool: 200,
      rechecked: 50,
      submitted: 47,
      submit_failed: 3,
    }),
    outcomeRow("shopfront-clone-urlscan-submit", 21, 75, {
      submitted: 42,
      submit_failed: 33,
      rate_limited: 0,
      dormant_retired: 0,
    }),
    outcomeRow("shopfront-clone-urlscan-retrieve", 2, 40, {
      classified: 40,
      still_pending: 0,
      unnotified_weaponised: 0,
    }),
    outcomeRow("shopfront-clone-netcraft-issue", 19, 2, {
      uuids: 3,
      filed: 2,
      notYetDeferred: 1,
      permanentRejects: 0,
      braked: false,
    }),
    outcomeRow("shopfront-clone-netcraft-resubmit", 20, 3, {
      candidates: 13,
      marked: 3,
      deferred: 10,
      dead: 10,
    }),
    outcomeRow("shopfront-clone-netcraft-reconcile", 3, 12, { uuids: 12 }),
    outcomeRow("shopfront-clone-nrd-daily-ingest", 22, 70000, {
      domains_scanned: 70000,
      hits_found: 27,
      total_chunks: 1,
      failed_chunks: 0,
    }),
    outcomeRow("shopfront-clone-feed-platform", 40, 2, { pool: 2, written: 2 }),
    rawRow("shopfront_clone_preclassify", "classify", 5, { is_clone: true }),
  ];
}

const without = (op: string) =>
  healthyRows().filter((r) => r.operation !== op);

describe("classifyLaneHealth", () => {
  it("has a shape for every roster Lane and counts them (proof of life is not conditional)", () => {
    const rosterIds = Object.keys(LANES).sort();
    expect(Object.keys(LANE_SHAPES).sort()).toEqual(rosterIds);
    expect(LANES_CHECKED).toBe(rosterIds.length + ABSENCE_WATCHES.length);
    expect(LANES_CHECKED).toBeGreaterThanOrEqual(9);
  });

  it("is silent on a healthy day", () => {
    expect(classifyLaneHealth(healthyRows(), { now: NOW })).toEqual([]);
  });

  it("pages on the Sep 12–16 submit rows: units 75, submitted 0, failed 0, rate_limited 0", () => {
    const rows = without("submit_batch");
    rows.push(
      outcomeRow("shopfront-clone-urlscan-submit", 21, 75, {
        submitted: 0,
        submit_failed: 0,
        rate_limited: 0,
        dormant_retired: 0,
        reputation_hits: 0,
      }),
    );
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-urlscan-submit",
        kind: "silent_zero",
      }),
    ]);
  });

  it("pages on the Sep 9–16 recheck rows: pool 200, rechecked 0, submit_failed 50 (and the 50/0/50 variant)", () => {
    const base = without("recheck_batch");
    const starvedRun = {
      pool: 200,
      rechecked: 0,
      submitted: 0,
      submit_failed: 50,
    };
    const starved = [
      ...base,
      outcomeRow("shopfront-clone-lifecycle-recheck", 1, 0, starvedRun),
      outcomeRow("shopfront-clone-lifecycle-recheck", 7, 0, starvedRun),
    ];
    expect(classifyLaneHealth(starved, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-lifecycle-recheck",
        kind: "silent_zero",
      }),
    ]);

    const allFailedRun = {
      pool: 200,
      rechecked: 50,
      submitted: 0,
      submit_failed: 50,
    };
    const allFailed = [
      ...base,
      outcomeRow("shopfront-clone-lifecycle-recheck", 1, 50, allFailedRun),
      outcomeRow("shopfront-clone-lifecycle-recheck", 7, 50, allFailedRun),
    ];
    expect(classifyLaneHealth(allFailed, { now: NOW })).toHaveLength(1);
  });

  it("a single quiet recheck run is NOT a page (consecutive=2)", () => {
    const rows = healthyRows();
    rows[0] = outcomeRow("shopfront-clone-lifecycle-recheck", 1, 0, {
      pool: 200,
      rechecked: 0,
      submitted: 0,
      submit_failed: 50,
    });
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);
  });

  it("reports a lane by ROSTER when it has logged nothing at all", () => {
    expect(classifyLaneHealth(without("nrd_daily_ingest"), { now: NOW })).toEqual(
      [
        expect.objectContaining({
          lane: "shopfront-clone-nrd-daily-ingest",
          kind: "absent",
        }),
      ],
    );
  });

  it("reports a lane whose last row is older than its cadence", () => {
    const rows = healthyRows().map((r) =>
      r.operation === "submit_batch" ? { ...r, created_at: ago(30) } : r,
    );
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-urlscan-submit",
        kind: "absent",
        detail: expect.stringMatching(/30h ago/),
      }),
    ]);
  });

  it("reports the absence-only preclassify stream when no per-alert row arrived", () => {
    expect(classifyLaneHealth(without("classify"), { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-haiku-preclassify",
        kind: "absent",
      }),
    ]);
  });

  it("reads brake state from feature_brakes, not from the latest row", () => {
    // The row that tripped the Sep 16 autobrake, still the latest row.
    const rows = without("issue_report");
    rows.push(
      outcomeRow("shopfront-clone-netcraft-issue", 19, 0, {
        uuids: 1,
        filed: 0,
        permanentRejects: 1,
        braked: true,
      }),
    );

    // Brake live → braked (and the row's reject shape is not double-reported).
    const live = { clone_netcraft_issue: new Date(NOW + 3_600_000).toISOString() };
    expect(classifyLaneHealth(rows, { now: NOW, brakes: live })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-netcraft-issue",
        kind: "braked",
        detail: expect.stringMatching(/feature_brakes\.clone_netcraft_issue/),
      }),
    ]);

    // Operator cleared it (paused_until in the past) but no run has written
    // since: the row still says braked:true and that must NOT be a finding.
    // The reject shape it carries still is — that's the row's job.
    const cleared = {
      clone_netcraft_issue: new Date(NOW - 5 * 3_600_000).toISOString(),
    };
    const p = classifyLaneHealth(rows, { now: NOW, brakes: cleared });
    expect(p.filter((x) => x.kind === "braked")).toEqual([]);
    expect(p).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-netcraft-issue",
        kind: "silent_zero",
      }),
    ]);
  });

  it("the 'not yet' reject shape (#1157) is silent_zero on its own", () => {
    const rows = without("issue_report");
    rows.push(
      outcomeRow("shopfront-clone-netcraft-issue", 19, 0, {
        uuids: 2,
        filed: 0,
        permanentRejects: 2,
        braked: false,
      }),
    );
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-netcraft-issue",
        kind: "silent_zero",
      }),
    ]);
  });

  it("the event-driven feed-platform lane is never 'absent', only silent_zero", () => {
    const none = without("feed_batch");
    expect(classifyLaneHealth(none, { now: NOW })).toEqual([]);
    const zero = [
      ...none,
      outcomeRow("shopfront-clone-feed-platform", 200, 50, {
        pool: 50,
        written: 0,
      }),
    ];
    expect(classifyLaneHealth(zero, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-feed-platform",
        kind: "silent_zero",
      }),
    ]);
  });

  it("a quiet-day outcome row (units 0, reason set) is neither absent nor silent_zero", () => {
    // Every roster lane writes one row per run even when it had nothing to
    // do (#1166). Before that, resubmit had no row on 4 of 13 days and issue
    // on 3 of 13 — each would have paged "absent". These are the exact
    // quiet-row shapes the lanes write.
    const rows = healthyRows().filter(
      (r) =>
        ![
          "recheck_batch",
          "submit_batch",
          "issue_report",
          "resubmit_bulk",
        ].includes(r.operation),
    );
    const quietRecheck = {
      reason: "nothing_due" as const,
      pool: 0,
      rechecked: 0,
      submitted: 0,
      submit_failed: 0,
    };
    rows.push(
      outcomeRow("shopfront-clone-lifecycle-recheck", 1, 0, quietRecheck),
      outcomeRow("shopfront-clone-lifecycle-recheck", 7, 0, quietRecheck),
      outcomeRow("shopfront-clone-urlscan-submit", 21, 0, {
        reason: "no_gated_candidates",
        submitted: 0,
        submit_failed: 0,
        rate_limited: 0,
        dormant_retired: 0,
      }),
      outcomeRow("shopfront-clone-netcraft-issue", 19, 0, {
        reason: "nothing_pending",
        uuids: 0,
        filed: 0,
        permanentRejects: 0,
        braked: false,
      }),
      outcomeRow("shopfront-clone-netcraft-resubmit", 20, 0, {
        reason: "all_dead",
        candidates: 9,
        dead: 9,
        deferred: 9,
        marked: 0,
      }),
    );
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);

    // The one quiet shape that MUST page: all dead but the deferral wrote
    // nothing — that is the worklist starvation itself.
    const starved = rows.map((r) =>
      r.operation === "resubmit_bulk"
        ? { ...r, metadata: { ...r.metadata, deferred: 0 } }
        : r,
    );
    expect(classifyLaneHealth(starved, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-netcraft-resubmit",
        kind: "silent_zero",
      }),
    ]);

    // Reconcile's quiet row is allowed to count: three in a row is a page.
    const noReconcile = rows.filter(
      (r) => r.operation !== "lifecycle_reconcile",
    );
    for (const h of [3, 15, 27]) {
      noReconcile.push(
        outcomeRow("shopfront-clone-netcraft-reconcile", h, 0, {
          reason: "nothing_pending",
          uuids: 0,
        }),
      );
    }
    expect(classifyLaneHealth(noReconcile, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-netcraft-reconcile",
        kind: "silent_zero",
      }),
    ]);
  });

  it("ignores rows for features outside the roster", () => {
    const rows = [
      ...healthyRows(),
      rawRow("hive_ai", "image_check", 1, { anything: 0 }),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);
  });
});
