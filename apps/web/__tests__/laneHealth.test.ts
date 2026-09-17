import { describe, expect, it } from "vitest";

import {
  classifyLaneHealth,
  LANE_SHAPES,
  type LaneCostRow,
} from "@/lib/laneHealth";

/**
 * The silent-zero detector (#1145) against the two incidents it exists for.
 * The fixtures are the REAL prod rows from cost_telemetry, not invented ones.
 *
 * Go-red record:
 *   - "Sep 12–16 submit rows": the submit_batch predicate reads `units` from
 *     the row column. Delete the `units` merge in metaOf → this passes the
 *     incident as healthy (units reads 0 → predicate false).
 *   - "Sep 9–16 recheck rows": drop the `submit_failed >= rechecked` arm →
 *     the `rechecked 50 / submitted 0 / submit_failed 50` variant is healthy.
 *   - "absent by roster": remove the `!latest` branch → a lane that logged
 *     nothing at all is silently skipped (the feed-health failure class).
 *   - "proof of life": LANE_SHAPES length is asserted so an emptied roster
 *     cannot pass as "no problems".
 */

const NOW = Date.parse("2026-09-17T06:30:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const row = (
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
    row("shopfront_clone_recheck", "recheck_batch", 1, {
      pool: 200,
      rechecked: 50,
      submitted: 47,
      submit_failed: 3,
    }),
    row("shopfront_clone_recheck", "recheck_batch", 7, {
      pool: 200,
      rechecked: 50,
      submitted: 47,
      submit_failed: 3,
    }),
    row(
      "shopfront_clone_urlscan",
      "submit_batch",
      21,
      { submitted: 42, submit_failed: 33, rate_limited: 0 },
      75,
    ),
    row("shopfront_clone_urlscan", "retrieve_batch", 2, {
      classified: 40,
      still_pending: 0,
      unnotified_weaponised: 0,
    }),
    row("shopfront_clone_netcraft_issue", "issue_report", 19, {
      uuids: 3,
      filed: 2,
      notYetDeferred: 1,
      permanentRejects: 0,
      braked: false,
    }),
    row("shopfront_clone_netcraft_resubmit", "resubmit_bulk", 20, {
      candidates: 13,
      marked: 3,
      deferred: 10,
    }),
    row("shopfront_clone_netcraft_reconcile", "lifecycle_reconcile", 3, {
      uuids: 12,
    }),
    row("shopfront_clone_watch", "nrd_daily_ingest", 22, {
      domains_scanned: 70000,
      hits_found: 27,
      total_chunks: 1,
      failed_chunks: 0,
    }),
    row("shopfront_clone_preclassify", "classify", 5, { is_clone: true }),
    row("clone_watch_feed_entity", "feed_batch", 40, { pool: 2, written: 2 }),
  ];
}

describe("classifyLaneHealth", () => {
  it("has a roster (proof of life is not conditional)", () => {
    expect(LANE_SHAPES.length).toBeGreaterThanOrEqual(9);
  });

  it("is silent on a healthy day", () => {
    expect(classifyLaneHealth(healthyRows(), NOW)).toEqual([]);
  });

  it("pages on the Sep 12–16 submit rows: units 75, submitted 0, failed 0, rate_limited 0", () => {
    const rows = healthyRows().filter((r) => r.operation !== "submit_batch");
    rows.push(
      row(
        "shopfront_clone_urlscan",
        "submit_batch",
        21,
        { submitted: 0, submit_failed: 0, rate_limited: 0, reputation_hits: 0 },
        75,
      ),
    );
    const p = classifyLaneHealth(rows, NOW);
    expect(p).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-urlscan-submit",
        kind: "silent_zero",
      }),
    ]);
  });

  it("pages on the Sep 9–16 recheck rows: pool 200, rechecked 0, submit_failed 50 (and the 50/0/50 variant)", () => {
    const base = healthyRows().filter((r) => r.operation !== "recheck_batch");
    const starved = [
      ...base,
      row("shopfront_clone_recheck", "recheck_batch", 1, {
        pool: 200,
        rechecked: 0,
        submitted: 0,
        submit_failed: 50,
      }),
      row("shopfront_clone_recheck", "recheck_batch", 7, {
        pool: 200,
        rechecked: 0,
        submitted: 0,
        submit_failed: 50,
      }),
    ];
    expect(classifyLaneHealth(starved, NOW)).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-lifecycle-recheck",
        kind: "silent_zero",
      }),
    ]);

    const allFailed = [
      ...base,
      row("shopfront_clone_recheck", "recheck_batch", 1, {
        pool: 200,
        rechecked: 50,
        submitted: 0,
        submit_failed: 50,
      }),
      row("shopfront_clone_recheck", "recheck_batch", 7, {
        pool: 200,
        rechecked: 50,
        submitted: 0,
        submit_failed: 50,
      }),
    ];
    expect(classifyLaneHealth(allFailed, NOW)).toHaveLength(1);
  });

  it("a single quiet recheck run is NOT a page (consecutive=2)", () => {
    const rows = healthyRows();
    rows[0] = row("shopfront_clone_recheck", "recheck_batch", 1, {
      pool: 200,
      rechecked: 0,
      submitted: 0,
      submit_failed: 50,
    });
    expect(classifyLaneHealth(rows, NOW)).toEqual([]);
  });

  it("reports a lane by ROSTER when it has logged nothing at all", () => {
    const rows = healthyRows().filter(
      (r) => r.operation !== "nrd_daily_ingest",
    );
    expect(classifyLaneHealth(rows, NOW)).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-nrd-daily-ingest",
        kind: "absent",
      }),
    ]);
  });

  it("reports a lane whose last row is older than its cadence", () => {
    const rows = healthyRows().map((r) =>
      r.operation === "submit_batch" ? { ...r, created_at: ago(30) } : r,
    );
    expect(classifyLaneHealth(rows, NOW)).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-urlscan-submit",
        kind: "absent",
        detail: expect.stringMatching(/30h ago/),
      }),
    ]);
  });

  it("reports the Sep 16 netcraft-issue autobrake as braked, and the 'not yet' reject shape as silent_zero", () => {
    const base = healthyRows().filter((r) => r.operation !== "issue_report");
    const braked = [
      ...base,
      row("shopfront_clone_netcraft_issue", "issue_report", 19, {
        uuids: 1,
        filed: 0,
        permanentRejects: 1,
        braked: true,
      }),
    ];
    expect(classifyLaneHealth(braked, NOW)).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-netcraft-issue",
        kind: "braked",
      }),
    ]);
    const rejected = [
      ...base,
      row("shopfront_clone_netcraft_issue", "issue_report", 19, {
        uuids: 2,
        filed: 0,
        permanentRejects: 2,
        braked: false,
      }),
    ];
    expect(classifyLaneHealth(rejected, NOW)).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-netcraft-issue",
        kind: "silent_zero",
      }),
    ]);
  });

  it("the event-driven feed-platform lane is never 'absent', only silent_zero", () => {
    const none = healthyRows().filter((r) => r.operation !== "feed_batch");
    expect(classifyLaneHealth(none, NOW)).toEqual([]);
    const zero = [
      ...none,
      row("clone_watch_feed_entity", "feed_batch", 200, {
        pool: 50,
        written: 0,
      }),
    ];
    expect(classifyLaneHealth(zero, NOW)).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-feed-platform",
        kind: "silent_zero",
      }),
    ]);
  });

  it("ignores rows for features outside the roster", () => {
    const rows = [
      ...healthyRows(),
      row("hive_ai", "image_check", 1, { anything: 0 }),
    ];
    expect(classifyLaneHealth(rows, NOW)).toEqual([]);
  });
});
