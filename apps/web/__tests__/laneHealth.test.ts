import { describe, expect, it, vi } from "vitest";

// Every lane's gate reads a flag; the shape tests below judge lanes as if
// they are ON (production), and the enabled() test flips flags explicitly.
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({} as Record<string, boolean>, {
    get: (t, k: string) => (k in t ? t[k] : true),
    set: (t, k: string, v: boolean) => ((t[k] = v), true),
  }),
}));

import {
  LANES,
  type LaneId,
  type LaneOutcome,
} from "@askarthur/scam-engine/lane-outcome";
import {
  ABSENCE_WATCHES,
  classifyLaneHealth,
  LANE_SHAPES,
  laneCrons,
  laneExpectEvery,
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
 *   - "cap_bound": drop the `capBound` entry on retrieve → the five-run bind
 *     is silent; drop the backlog comparison → a draining enricher pages.
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
    outcomeRow("shopfront-clone-netcraft-auto/resubmit", 20, 3, {
      candidates: 13,
      marked: 3,
      deferred: 10,
      dead: 10,
    }),
    outcomeRow("shopfront-clone-netcraft-reconcile", 3, 12, { uuids: 12 }),
    outcomeRow("shopfront-nrd-daily-ingest", 22, 70000, {
      domains_scanned: 70000,
      hits_found: 27,
      total_chunks: 1,
      failed_chunks: 0,
    }),
    outcomeRow("shopfront-clone-feed-platform", 40, 2, { pool: 2, written: 2 }),
    outcomeRow("shopfront-clone-netcraft-auto/auto", 20, 1, { candidates: 1, marked: 1 }),
    outcomeRow("clone-watch-enrich-attribution", 19, 60, { pending: 60, enriched: 60 }),
    outcomeRow("shopfront-clone-notify-brand-prepare", 23, 2, {
      batches_prepared: 2,
      groups_failed: 0,
    }),
    outcomeRow("shopfront-clone-reemergence-monitor", 17, 5, { checked: 5, reemerged: 0 }),
    outcomeRow("shopfront-clone-enforcement-execute", 2, 3, { candidates: 3, enqueued: 3 }),
    outcomeRow("shopfront-clone-weekly-digest", 3 * 24, 1, { candidates_total: 180 }),
    outcomeRow("shopfront-clone-fp-cluster-digest", 3 * 24, 0, {
      reason: "no_fps_in_window",
      clusters: 0,
      fp_count: 0,
    }),
    outcomeRow("report-brand-stewardship", 20 * 24, 28, {
      prepared: 28,
      failed: 0,
      clone_brands: 148,
    }),
    // Monthly: written on the 1st, so up to ~31 days old on a healthy day.
    outcomeRow("clone-watch-report-summary", 20 * 24, 148, {
      total: 855,
      brand_rows: 148,
    }),
    // Monthly (1st, 01:00) — ten hours before the summary.
    outcomeRow("clone-watch-month-end-liveness", 20 * 24, 3000, {
      stock: 3000,
      probed: 2850,
      unverified: 150,
      not_probed: 0,
    }),
    rawRow("shopfront_clone_preclassify", "classify", 5, { is_clone: true }),
  ];
}

const without = (op: string) => healthyRows().filter((r) => r.operation !== op);

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

  // 2026-09-24: the recheck lane used to count a urlscan 429 as submit_failed
  // and leave it out of `rechecked`, so a quota day paged as silent_zero. Quota
  // is not a broken lane — the submit lane already excluded it.
  it("an all-rate-limited recheck run is NOT silent_zero (quota, not breakage)", () => {
    const quotaRun = {
      pool: 200,
      rechecked: 0,
      submitted: 0,
      submit_failed: 0,
      rate_limited: 50,
    };
    const rows = [
      ...without("recheck_batch"),
      outcomeRow("shopfront-clone-lifecycle-recheck", 1, 0, quotaRun),
      outcomeRow("shopfront-clone-lifecycle-recheck", 7, 0, quotaRun),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);
  });

  it("a mostly-rate-limited recheck run is NOT silent_zero", () => {
    const mostlyQuota = {
      pool: 200,
      rechecked: 5, // dns-skipped rows are still "looked at"
      submitted: 0,
      submit_failed: 0,
      dns_skipped: 5,
      rate_limited: 45,
    };
    const rows = [
      ...without("recheck_batch"),
      outcomeRow("shopfront-clone-lifecycle-recheck", 1, 5, mostlyQuota),
      outcomeRow("shopfront-clone-lifecycle-recheck", 7, 5, mostlyQuota),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);
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
    expect(
      classifyLaneHealth(without("nrd_daily_ingest"), { now: NOW }),
    ).toEqual([
      expect.objectContaining({
        lane: "shopfront-nrd-daily-ingest",
        kind: "absent",
      }),
    ]);
  });

  it("excuses a never-written lane until its firstExpectedAt, then reports it absent", () => {
    const rows = without("stock_snapshot");
    const liveness = (now: number) =>
      classifyLaneHealth(rows, { now }).filter(
        (p) => p.lane === "clone-watch-month-end-liveness",
      );
    // Before the first scheduled run (1 Oct 01:00) — nothing to report.
    expect(liveness(NOW)).toEqual([]);
    // After it — the missing row is the "active_stock_eom NULL" explanation.
    expect(liveness(Date.parse("2026-10-02T00:00:00Z"))).toEqual([
      expect.objectContaining({ kind: "absent" }),
    ]);
  });

  describe("cap_bound (#1231)", () => {
    const retrieveRow = (h: number, reached: boolean) =>
      outcomeRow("shopfront-clone-urlscan-retrieve", h, 100, {
        classified: 90,
        still_pending: 10,
        unnotified_weaponised: 0,
        cap: 100,
        cap_reached: reached,
      });
    const withRetrieve = (rows: LaneCostRow[]) => [
      ...healthyRows().filter((r) => r.operation !== LANES["shopfront-clone-urlscan-retrieve"].operation),
      ...rows,
    ];
    const kinds = (rows: LaneCostRow[]) =>
      classifyLaneHealth(rows, { now: NOW }).map((p) => `${p.lane}:${p.kind}`);

    it("pages when the cap bound every one of the last N runs", () => {
      const rows = withRetrieve([1, 4, 7, 10, 13].map((h) => retrieveRow(h, true)));
      expect(kinds(rows)).toEqual(["shopfront-clone-urlscan-retrieve:cap_bound"]);
    });

    it("stays quiet when one of the last N runs had slack", () => {
      const rows = withRetrieve([1, 4, 7, 10, 13].map((h, i) => retrieveRow(h, i !== 2)));
      expect(kinds(rows)).toEqual([]);
    });

    const enrichRow = (h: number, backlog: number | null) =>
      outcomeRow("clone-watch-enrich-attribution", h, 60, {
        pending: 60,
        enriched: 60,
        cap: 60,
        cap_reached: true,
        backlog,
      });
    const withEnrich = (rows: LaneCostRow[]) => [
      ...healthyRows().filter((r) => r.operation !== LANES["clone-watch-enrich-attribution"].operation),
      ...rows,
    ];

    it("stays quiet while the backlog drains at the cap (the cap working)", () => {
      const rows = withEnrich([enrichRow(1, 40), enrichRow(25, 90), enrichRow(49, 150)]);
      expect(kinds(rows)).toEqual([]);
    });

    it("pages when the backlog holds or grows at the cap", () => {
      const rows = withEnrich([enrichRow(1, 160), enrichRow(25, 150), enrichRow(49, 150)]);
      expect(kinds(rows)).toEqual(["clone-watch-enrich-attribution:cap_bound"]);
    });

    // #1253. Go-red (2026-09-27): drop the `whois_reoffer_due` disjunct from
    // the enrich shape → "a stalled WHOIS re-offer" is silent.
    const reofferRow = (h: number, due: number | null, reoffered: number) =>
      outcomeRow("clone-watch-enrich-attribution", h, 0, {
        reason: "nothing_pending",
        pending: 0,
        enriched: 0,
        whois_reoffer_due: due,
        whois_reoffered: reoffered,
      });

    it("a stalled WHOIS re-offer (due rows, none started) is silent_zero on a quiet enrich day", () => {
      const rows = withEnrich([reofferRow(1, 20, 0), reofferRow(25, 20, 0)]);
      expect(kinds(rows)).toEqual(["clone-watch-enrich-attribution:silent_zero"]);
    });

    it("a working re-offer, or an unknown due count (null), does not page", () => {
      expect(kinds(withEnrich([reofferRow(1, 20, 20), reofferRow(25, 20, 20)]))).toEqual([]);
      expect(kinds(withEnrich([reofferRow(1, null, 0), reofferRow(25, null, 0)]))).toEqual([]);
    });

    it("silent_zero outranks cap_bound (a capped retrieve holding an unnotified weaponised alert)", () => {
      const rows = withRetrieve(
        [1, 4, 7, 10, 13].map((h) =>
          outcomeRow("shopfront-clone-urlscan-retrieve", h, 100, {
            classified: 90,
            still_pending: 10,
            unnotified_weaponised: 2,
            cap: 100,
            cap_reached: true,
          }),
        ),
      );
      expect(kinds(rows)).toEqual(["shopfront-clone-urlscan-retrieve:silent_zero"]);
    });

    it("never pages lifecycle-recheck for its cap — its demand is structurally over quota", () => {
      const rows = healthyRows().map((r) =>
        r.operation === LANES["shopfront-clone-lifecycle-recheck"].operation
          ? { ...r, metadata: { ...r.metadata, cap: 90, cap_reached: true, due_total: 1400 } }
          : r,
      );
      expect(kinds(rows)).toEqual([]);
    });
  });

  it("a PARKED lane has no schedule and never pages absent (#1230)", () => {
    expect(LANE_SHAPES["shopfront-clone-fp-cluster-digest"].parked).toBeTruthy();
    expect(laneCrons("shopfront-clone-fp-cluster-digest")).toEqual([]);
    expect(laneExpectEvery("shopfront-clone-fp-cluster-digest")).toBe(Number.POSITIVE_INFINITY);
    const problems = classifyLaneHealth(
      without(LANES["shopfront-clone-fp-cluster-digest"].operation).filter(
        (r) => r.feature !== LANES["shopfront-clone-fp-cluster-digest"].feature,
      ),
      { now: NOW },
    );
    expect(problems.filter((p) => p.lane === "shopfront-clone-fp-cluster-digest")).toEqual([]);
    // The restore value is kept: un-parking is deleting the one field.
    expect(LANE_SHAPES["shopfront-clone-fp-cluster-digest"].crons).toEqual(["30 9 * * 0"]);
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
    const live = {
      clone_netcraft_issue: new Date(NOW + 3_600_000).toISOString(),
    };
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

  // #1230: auto-park moved into the pre-classifier and is fail-soft there (a
  // failed park never fails a batch of paid classifications). Fail-soft must
  // not be silent: the Outcome Row's `auto_park_failed` pages.
  // Go-red (2026-09-26): drop the `|| o.auto_park_failed === true` arm in
  // LANE_SHAPES["shopfront-clone-haiku-preclassify"] → the first case below
  // reports [] and fails; the second stays green.
  it("pre-classifier pages when its auto-park failed, even though the batch classified", () => {
    const rows = healthyRows();
    rows.push(
      outcomeRow("shopfront-clone-haiku-preclassify", 5, 5, {
        alerts: 5,
        classified: 5,
        failed: 0,
        auto_parked: 0,
        auto_park_failed: true,
      }),
    );
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-haiku-preclassify",
        kind: "silent_zero",
      }),
    ]);
  });

  it("pre-classifier is quiet on a batch that parked, parked nothing, or predates the field", () => {
    for (const extra of [
      { auto_parked: 2, auto_park_failed: false },
      { auto_parked: 0, auto_park_failed: false },
      {},
    ]) {
      const rows = healthyRows();
      rows.push(
        outcomeRow("shopfront-clone-haiku-preclassify", 5, 5, {
          alerts: 5,
          classified: 5,
          failed: 0,
          ...extra,
        }),
      );
      expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);
    }
  });

  it("the retired auto-triage lane is gone from the roster and the digest (#1230)", () => {
    expect(Object.keys(LANES)).not.toContain("clone-watch-auto-triage");
    expect(Object.keys(LANE_SHAPES)).not.toContain("clone-watch-auto-triage");
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
      outcomeRow("shopfront-clone-netcraft-auto/resubmit", 20, 0, {
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
        lane: "shopfront-clone-netcraft-auto/resubmit",
        kind: "silent_zero",
      }),
    ]);

    // Reconcile: quiet rows are NORMAL under the v316 backoff — three in a
    // row must NOT page (read failures page as Lane errors instead).
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
    expect(classifyLaneHealth(noReconcile, { now: NOW })).toEqual([]);
  });

  // v329 review (#1254): the weaponised outcome steps soft-fail into FIELDS,
  // so without this shape a missing v329 or a broken RPC was silent forever.
  // Go-red: `silentZero: () => false` (the pre-review shape) fails all three
  // "pages" cases.
  it("reconcile pages on a soft-failed v329 step, not on a quiet worklist", () => {
    const base = healthyRows().filter((r) => r.operation !== "lifecycle_reconcile");
    const judge = (outcome: LaneOutcome["shopfront-clone-netcraft-reconcile"]) =>
      classifyLaneHealth(
        [...base, outcomeRow("shopfront-clone-netcraft-reconcile", 3, 0, outcome)],
        { now: NOW },
      );
    const paged = [
      expect.objectContaining({
        lane: "shopfront-clone-netcraft-reconcile",
        kind: "silent_zero",
      }),
    ];
    // v329 not applied: the list RPC does not exist.
    expect(
      judge({ uuids: 0, liveness_checked: null, liveness_error: "list: function not found" }),
    ).toEqual(paged);
    // The operator page failed to send (Telegram 5xx) — nothing was stamped.
    expect(
      judge({ uuids: 0, liveness_checked: 3, vendor_gap_escalated: 0, vendor_gap_error: "page: send_failed" }),
    ).toEqual(paged);
    // Work was due and nothing was read.
    expect(judge({ uuids: 0, liveness_due: 142, liveness_checked: 0 })).toEqual(paged);
    // Healthy: work due and read; or nothing due at all.
    expect(judge({ uuids: 0, liveness_due: 142, liveness_checked: 142, vendor_gap_escalated: 50 })).toEqual([]);
    expect(judge({ uuids: 0, liveness_due: 0, liveness_checked: 0 })).toEqual([]);
  });

  it("ignores rows for features outside the roster", () => {
    const rows = [
      ...healthyRows(),
      rawRow("hive_ai", "image_check", 1, { anything: 0 }),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);
  });
});

// A flag-off Lane writes nothing by design; its declared `flags` keep it from
// paging "absent" every day, and it pages the moment the flags are on and rows
// stop. The SAME declaration gates the Lane body (laneGate), so the two cannot
// disagree.
describe("classifyLaneHealth — flag gate", () => {
  it("skips a disabled lane, flags it absent once enabled", async () => {
    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    const flags = featureFlags as unknown as Record<string, boolean>;
    const saved = { e: flags.cloneEnforcement, r: flags.cloneReemergenceMonitor };
    try {
      flags.cloneEnforcement = false;
      flags.cloneReemergenceMonitor = false;
      expect(
        classifyLaneHealth([]).some((p) => p.lane === "shopfront-clone-reemergence-monitor"),
      ).toBe(false);
      flags.cloneEnforcement = true;
      flags.cloneReemergenceMonitor = true;
      expect(
        classifyLaneHealth([]).find((p) => p.lane === "shopfront-clone-reemergence-monitor")?.kind,
      ).toBe("absent");
    } finally {
      flags.cloneEnforcement = saved.e;
      flags.cloneReemergenceMonitor = saved.r;
    }
  });
});

// Review 2026-09-23: the digest fetched ONE 72 h window, so every weekly /
// monthly lane read "absent" most days. The fetch plan is derived from the
// shapes; this pins that every lane's expectEvery fits its window.
describe("laneFetchPlan", () => {
  it("covers every finite expectEvery (and every absence watch) with a wide-enough window", async () => {
    const { laneFetchPlan, laneExpectEvery, LANE_SHAPES: shapes, ABSENCE_WATCHES: watches } = await import("@/lib/laneHealth");
    const plan = laneFetchPlan();
    const windowFor = (feature: string) =>
      Math.max(0, ...plan.filter((g) => g.features.includes(feature)).map((g) => g.windowMs));
    for (const lane of Object.keys(shapes) as Array<keyof typeof LANES>) {
      const feature = LANES[lane].feature;
      const every = laneExpectEvery(lane);
      expect(windowFor(feature), `${lane} is not fetched`).toBeGreaterThan(0);
      if (Number.isFinite(every)) {
        expect(windowFor(feature), `${lane}: window < expectEvery`).toBeGreaterThanOrEqual(every);
      }
    }
    for (const w of watches) expect(windowFor(w.feature)).toBeGreaterThanOrEqual(w.expectEvery);
  });

  it("a monthly lane last seen 20 days ago is healthy, not absent", () => {
    const rows = healthyRows();
    const problems = classifyLaneHealth(rows, { now: NOW });
    expect(problems.find((p) => p.lane === "clone-watch-report-summary")).toBeUndefined();
  });
});

describe("classifyLaneHealth — brake before absence", () => {
  it("a braked lane with no rows is reported braked, not absent", () => {
    const rows = healthyRows().filter((r) => r.operation !== "recheck_batch");
    const brakes = { shopfront_clone_recheck: new Date(NOW + 3_600_000).toISOString() };
    const p = classifyLaneHealth(rows, { now: NOW, brakes }).find(
      (x) => x.lane === "shopfront-clone-lifecycle-recheck",
    );
    expect(p?.kind).toBe("braked");
  });
});

// One declaration per Lane (architecture review 2026-09-24, #1): the schedule,
// the health window and the flag gate are read from LANE_SHAPES by both the
// Lane and the digest instead of being typed twice.
describe("Lane declaration", () => {
  it("every Lane resolves a health window (explicit, or derived from its crons)", async () => {
    const { laneExpectEvery, LANE_SHAPES: shapes } = await import("@/lib/laneHealth");
    for (const lane of Object.keys(shapes) as Array<keyof typeof LANES>) {
      expect(() => laneExpectEvery(lane), lane).not.toThrow();
      expect(laneExpectEvery(lane), lane).toBeGreaterThan(0);
    }
  });

  it("a cron-driven window covers at least one full gap between runs", async () => {
    const { laneExpectEvery, LANE_SHAPES: shapes } = await import("@/lib/laneHealth");
    const { cronMaxGapMs } = await import("@/lib/cron-cadence");
    for (const [lane, shape] of Object.entries(shapes)) {
      if (!shape.crons || shape.expectEvery !== undefined) continue;
      expect(laneExpectEvery(lane as keyof typeof LANES), lane).toBeGreaterThan(
        cronMaxGapMs(shape.crons),
      );
    }
  });

  it("laneGate names the first flag that is off", async () => {
    const { laneGate } = await import("@/lib/laneHealth");
    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    const flags = featureFlags as unknown as Record<string, boolean>;
    const saved = { o: flags.shopfrontCloneOutreach, i: flags.cloneNetcraftIssue };
    try {
      flags.shopfrontCloneOutreach = true;
      flags.cloneNetcraftIssue = true;
      expect(laneGate("shopfront-clone-netcraft-issue")).toEqual({ ok: true });
      flags.cloneNetcraftIssue = false;
      expect(laneGate("shopfront-clone-netcraft-issue")).toEqual({
        ok: false,
        reason: "cloneNetcraftIssue disabled",
      });
    } finally {
      flags.shopfrontCloneOutreach = saved.o;
      flags.cloneNetcraftIssue = saved.i;
    }
  });

  it("laneCrons refuses an event-driven Lane", async () => {
    const { laneCrons } = await import("@/lib/laneHealth");
    expect(() => laneCrons("shopfront-clone-feed-platform")).toThrow();
    expect(laneCrons("shopfront-clone-netcraft-reconcile")).toEqual([
      { cron: "0 10 * * *" },
      { cron: "0 22 * * *" },
    ]);
  });
});

describe("classifyLaneHealth — unreadable brakes", () => {
  it("reports brake_unknown once instead of silently judging every lane unbraked", () => {
    const problems = classifyLaneHealth(healthyRows(), { now: NOW, brakes: "unreadable" });
    expect(problems).toEqual([
      expect.objectContaining({ lane: "feature_brakes", kind: "brake_unknown" }),
    ]);
  });
});

// The one roster Lane that cannot read LANE_SHAPES: it lives in scam-engine,
// which must not import apps/web. Parity is enforced here instead.
describe("Lane declaration — scam-engine Lanes", () => {
  it("shopfront-nrd-daily-ingest's cron and flag match its LANE_SHAPES entry", async () => {
    const { readFileSync } = await import("node:fs");
    const { LANE_SHAPES: shapes } = await import("@/lib/laneHealth");
    const src = readFileSync(
      new URL(
        "../../../packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const crons = [...src.matchAll(/\bcron:\s*"([^"]+)"/g)].map((m) => m[1]);
    const shape = shapes["shopfront-nrd-daily-ingest"];
    expect(crons).toEqual(shape.crons);
    for (const flag of shape.flags ?? []) {
      expect(src, `gate on ${flag}`).toContain(`!featureFlags.${flag}`);
    }
  });
});

// review 2026-09-24: silent_zero excludes quota-limited runs (a 429 day is not
// a broken lane), which left a PERSISTENT quota loss paging nowhere. It now has
// its own, longer depth.
describe("classifyLaneHealth — persistent vendor quota", () => {
  const quotaRun = {
    pool: 200,
    rechecked: 0,
    submitted: 0,
    submit_failed: 0,
    rate_limited: 50,
  };
  it("pages quota_exhausted after 4 all-429 recheck runs (~24h)", () => {
    const rows = [
      ...without("recheck_batch"),
      ...[1, 7, 13, 19].map((h) =>
        outcomeRow("shopfront-clone-lifecycle-recheck", h, 0, quotaRun),
      ),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-lifecycle-recheck",
        kind: "quota_exhausted",
      }),
    ]);
  });

  it("stays quiet for 3 (one bad quota day is not a page)", () => {
    const rows = [
      ...without("recheck_batch"),
      ...[1, 7, 13].map((h) =>
        outcomeRow("shopfront-clone-lifecycle-recheck", h, 0, quotaRun),
      ),
      outcomeRow("shopfront-clone-lifecycle-recheck", 19, 50, {
        pool: 200,
        rechecked: 50,
        submitted: 47,
        submit_failed: 3,
      }),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);
  });

  // Quota must not mask a broken lane: runs with genuine submit failures as
  // well as 429s are silent_zero, never quota_exhausted.
  it("reports mixed 429 + real-failure runs as silent_zero, not quota", () => {
    const mixed = {
      pool: 200,
      rechecked: 20,
      submitted: 0,
      submit_failed: 20,
      rate_limited: 30,
    };
    const rows = [
      ...without("recheck_batch"),
      ...[1, 7, 13, 19].map((h) =>
        outcomeRow("shopfront-clone-lifecycle-recheck", h, 20, mixed),
      ),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-lifecycle-recheck",
        kind: "silent_zero",
      }),
    ]);
  });

  // Coordinator review of #1210: runs mixing 429s with genuine failures and
  // zero successes must page on the FIRST lane rule, not fall between the two.
  it("pages a submit run with real failures even when some were rate-limited", () => {
    const rows = [
      ...without("submit_batch"),
      outcomeRow("shopfront-clone-urlscan-submit", 21, 50, {
        submitted: 0,
        submit_failed: 20,
        rate_limited: 30,
        dormant_retired: 0,
      }),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-urlscan-submit",
        kind: "silent_zero",
      }),
    ]);
  });

  it("pages a recheck run with some real failures, the rest DNS-skipped or rate-limited", () => {
    const run = {
      pool: 200,
      rechecked: 20,
      submitted: 0,
      submit_failed: 5,
      dns_skipped: 15,
      rate_limited: 30,
    };
    const rows = [
      ...without("recheck_batch"),
      outcomeRow("shopfront-clone-lifecycle-recheck", 1, 20, run),
      outcomeRow("shopfront-clone-lifecycle-recheck", 7, 20, run),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-lifecycle-recheck",
        kind: "silent_zero",
      }),
    ]);
  });

  it("pages the daily submit lane after 2 all-429 runs", () => {
    const run = { submitted: 0, submit_failed: 0, rate_limited: 30, dormant_retired: 0 };
    const rows = [
      ...without("submit_batch"),
      outcomeRow("shopfront-clone-urlscan-submit", 21, 30, run),
      outcomeRow("shopfront-clone-urlscan-submit", 45, 30, run),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({
        lane: "shopfront-clone-urlscan-submit",
        kind: "quota_exhausted",
      }),
    ]);
  });
});

// 2026-09-25: DNS-precheck skips (no_host / SERVFAIL) are not work. A daily
// submit whose whole batch was dead domains correctly submitted nothing and
// must not page; a real failure among them still must.
describe("urlscan submit — DNS-precheck skips are not work", () => {
  it("an all-dead-domain batch is not silent_zero", () => {
    const rows = [
      ...without("submit_batch"),
      outcomeRow("shopfront-clone-urlscan-submit", 21, 40, {
        submitted: 0,
        submit_failed: 0,
        rate_limited: 0,
        dormant_retired: 0,
        dns_skipped: 25,
        dns_servfail: 15,
      }),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([]);
  });

  it("a genuine failure among dead domains still pages", () => {
    const rows = [
      ...without("submit_batch"),
      outcomeRow("shopfront-clone-urlscan-submit", 21, 40, {
        submitted: 0,
        submit_failed: 2,
        rate_limited: 0,
        dormant_retired: 0,
        dns_skipped: 25,
        dns_servfail: 13,
      }),
    ];
    expect(classifyLaneHealth(rows, { now: NOW })).toEqual([
      expect.objectContaining({ lane: "shopfront-clone-urlscan-submit", kind: "silent_zero" }),
    ]);
  });
});
