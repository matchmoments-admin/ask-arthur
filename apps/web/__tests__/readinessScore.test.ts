// Pure scoring of the readiness scorecard (#1237) — lib/clone-watch/readiness.ts.
//
// The rules under test: NULL = not measured (never 0); too little data is
// "insufficient", which is NOT a fail but still keeps the month not ready;
// `ready` needs all seven components to pass; the gate needs every required
// closed month present AND ready, and an unreadable scorecard is not ready.
//
// Go-red record (2026-09-27, each guard broken → its test failed → restored):
//   - precision: dropped the `n < precisionMinN` insufficient branch
//        → "precision with too few verdicts is insufficient, not pass" FAILED
//   - fp_share: fp share compared with `>=` instead of `<=`
//        → "fp share passes at or under the cap and fails above it" FAILED
//   - fn_rate: dropped the sampled === 0 branch (it still reads insufficient
//     via scanned < min, but says "0 of 0 scanned" instead of naming the
//     deferred baseline) → "fn rate is insufficient until the baseline is
//     drawn" FAILED on its reason assertion
//   - lane_health: dropped the measured-days coverage check
//        → "a partly measured clean month is insufficient" FAILED
//   - lane_health: dropped the early fail on problem_days > max
//        → "a known failure is reported from a partial month" FAILED
//   - takedown: dropped the negative-duration check
//        → "a negative duration in ANY column fails" FAILED
//   - takedown: dropped the median-vs-n label check
//        → "a median with no sample fails the label check" FAILED
//   - stock: completedAt null treated as measured
//        → "stock without a completed run is insufficient" FAILED
//   - scoreReadiness: ready = no component "fail" (insufficient allowed)
//        → "one insufficient component keeps the month not ready" FAILED
//   - diffBrandClones: brands on one side only skipped
//        → "a brand present on one side only counts its whole count" FAILED
//   - evaluateReadinessGate: dropped the missing-month check
//        → "a missing month is not ready" FAILED
//   - evaluateReadinessGate: required < 1 returned ready
//        → "a misconfigured required-months constant never opens the gate" FAILED

import { describe, expect, it } from "vitest";
import {
  diffBrandClones,
  evaluateReadinessGate,
  fromReadinessRow,
  READINESS_THRESHOLDS,
  requiredMonths,
  scoreReadiness,
  toReadinessRow,
  type ReadinessInputs,
  type TriageAndLaneInputs,
} from "@/lib/clone-watch/readiness";

const SQL: TriageAndLaneInputs = {
  human_triaged: 40,
  human_fp: 4,
  phishing_tp: 20,
  phishing_fp: 0,
  machine_fp: 0,
  classified: 100,
  classifier_rejected: 14,
  window_days: 30,
  measured_days: 30,
  problem_days: 1,
  problem_kinds: { absent: 1 },
  problem_lanes: ["x"],
};
const TAKEDOWN = {
  window_days: 30,
  takedowns_total: 8,
  median_minutes: 40,
  p90_minutes: 90,
  fastest_minutes: 5,
  slowest_minutes: 100,
  timed_n: 3,
  detect_to_block_n: 7,
  detect_to_block_median_minutes: 231,
  detect_to_block_p90_minutes: 952,
  detect_to_offline_median_minutes: null,
};
const ALL_PASS: ReadinessInputs = {
  periodMonth: "2026-09-01",
  sql: SQL,
  notAClone: { sampled: 100, scanned: 60, misses: 1 },
  report: { brandsCompared: 148, maxDiff: 0, brandsDiffering: 0 },
  takedown: TAKEDOWN,
  stock: { stock: 2376, unverified: 122, completedAt: "2026-10-01T01:30:00Z" },
};
const comp = (i: ReadinessInputs, key: string) =>
  scoreReadiness(i).components.find((c) => c.key === key)!;

describe("scoreReadiness", () => {
  it("all seven pass → ready", () => {
    const card = scoreReadiness(ALL_PASS);
    expect(card.components.map((c) => c.status)).toEqual(Array(7).fill("pass"));
    expect(card.ready).toBe(true);
  });

  it("one insufficient component keeps the month not ready", () => {
    const card = scoreReadiness({ ...ALL_PASS, notAClone: { sampled: 0, scanned: 0, misses: 0 } });
    expect(card.components.find((c) => c.key === "fn_rate")!.status).toBe("insufficient");
    expect(card.components.some((c) => c.status === "fail")).toBe(false);
    expect(card.ready).toBe(false);
  });

  it("an unreadable source is insufficient with NULL value and n — never 0", () => {
    const c = comp({ ...ALL_PASS, sql: null }, "precision");
    expect(c).toMatchObject({ status: "insufficient", value: null, n: null });
    expect(comp({ ...ALL_PASS, takedown: null }, "takedown")).toMatchObject({ status: "insufficient", value: null, n: null });
  });

  it("precision with too few verdicts is insufficient, not pass", () => {
    const c = comp({ ...ALL_PASS, sql: { ...SQL, phishing_tp: 9, phishing_fp: 0 } }, "precision");
    expect(c.status).toBe("insufficient");
    expect(c.n).toBe(9);
    expect(c.reason).toContain("10 needed");
  });

  it("precision passes at the threshold and fails below it", () => {
    expect(comp({ ...ALL_PASS, sql: { ...SQL, phishing_tp: 19, phishing_fp: 1 } }, "precision").status).toBe("pass");
    expect(comp({ ...ALL_PASS, sql: { ...SQL, phishing_tp: 18, phishing_fp: 2 } }, "precision").status).toBe("fail");
  });

  it("fp share passes at or under the cap and fails above it", () => {
    expect(comp({ ...ALL_PASS, sql: { ...SQL, human_triaged: 40, human_fp: 10 } }, "fp_share").status).toBe("pass");
    expect(comp({ ...ALL_PASS, sql: { ...SQL, human_triaged: 40, human_fp: 11 } }, "fp_share").status).toBe("fail");
  });

  it("fp share names rule-based rejects as excluded and the classifier share as context", () => {
    const c = comp({ ...ALL_PASS, sql: { ...SQL, human_triaged: 0, human_fp: 0, machine_fp: 466 } }, "fp_share");
    expect(c.status).toBe("insufficient");
    expect(c.reason).toContain("466 rule-based bulk rejects excluded");
    expect(c.reason).toContain("14.0% of 100");
  });

  it("fn rate is insufficient until the baseline is drawn", () => {
    const c = comp({ ...ALL_PASS, notAClone: { sampled: 0, scanned: 0, misses: 0 } }, "fn_rate");
    expect(c).toMatchObject({ status: "insufficient", value: null, n: 0 });
    expect(c.reason).toContain("baseline is deferred");
    expect(comp({ ...ALL_PASS, notAClone: { sampled: 50, scanned: 29, misses: 0 } }, "fn_rate").status).toBe("insufficient");
    expect(comp({ ...ALL_PASS, notAClone: { sampled: 50, scanned: 40, misses: 3 } }, "fn_rate").status).toBe("fail");
  });

  it("a partly measured clean month is insufficient", () => {
    const c = comp({ ...ALL_PASS, sql: { ...SQL, measured_days: 8, problem_days: 0, problem_kinds: {} } }, "lane_health");
    expect(c.status).toBe("insufficient");
    expect(c.n).toBe(8);
  });

  it("a known failure is reported from a partial month", () => {
    const c = comp(
      { ...ALL_PASS, sql: { ...SQL, measured_days: 8, problem_days: 5, problem_kinds: { absent: 4, silent_zero: 1 } } },
      "lane_health",
    );
    expect(c).toMatchObject({ status: "fail", value: 5, n: 8 });
    expect(c.reason).toContain("absent 4d");
  });

  it("lane health at the limit passes", () => {
    expect(comp({ ...ALL_PASS, sql: { ...SQL, problem_days: 2 } }, "lane_health").status).toBe("pass");
    expect(comp({ ...ALL_PASS, sql: { ...SQL, problem_days: 3 } }, "lane_health").status).toBe("fail");
  });

  it("report diff: not frozen is insufficient and says why; limits on both max and share", () => {
    const c = comp({ ...ALL_PASS, report: null, reportUnavailable: "not frozen" }, "report_diff");
    expect(c).toMatchObject({ status: "insufficient", reason: "not frozen" });
    expect(comp({ ...ALL_PASS, report: { brandsCompared: 148, maxDiff: 2, brandsDiffering: 1 } }, "report_diff").status).toBe("fail");
    expect(comp({ ...ALL_PASS, report: { brandsCompared: 100, maxDiff: 1, brandsDiffering: 3 } }, "report_diff").status).toBe("fail");
    expect(comp({ ...ALL_PASS, report: { brandsCompared: 100, maxDiff: 1, brandsDiffering: 2 } }, "report_diff").status).toBe("pass");
  });

  it("a negative duration in ANY column fails", () => {
    for (const col of ["fastest_minutes", "detect_to_offline_median_minutes", "slowest_minutes"]) {
      const c = comp({ ...ALL_PASS, takedown: { ...TAKEDOWN, [col]: -2 } }, "takedown");
      expect(c.status, col).toBe("fail");
      expect(c.value).toBe(1);
    }
  });

  it("a median with no sample fails the label check; a sample with no median too", () => {
    expect(comp({ ...ALL_PASS, takedown: { ...TAKEDOWN, timed_n: 0 } }, "takedown").status).toBe("fail");
    expect(comp({ ...ALL_PASS, takedown: { ...TAKEDOWN, detect_to_block_median_minutes: null } }, "takedown").status).toBe("fail");
    // Honest empties pass: n = 0 and median NULL.
    expect(
      comp({ ...ALL_PASS, takedown: { ...TAKEDOWN, timed_n: 0, median_minutes: null, p90_minutes: null } }, "takedown").status,
    ).toBe("pass");
  });

  it("a pre-v329 takedown row (no per-clock n) is insufficient, not a pass", () => {
    const { timed_n: _t, detect_to_block_n: _d, ...v145 } = TAKEDOWN;
    expect(comp({ ...ALL_PASS, takedown: v145 }, "takedown").status).toBe("insufficient");
  });

  it("stock without a completed run is insufficient; over 20% unverified fails", () => {
    expect(comp({ ...ALL_PASS, stock: null }, "stock").status).toBe("insufficient");
    expect(comp({ ...ALL_PASS, stock: { stock: 10, unverified: 0, completedAt: null } }, "stock").status).toBe("insufficient");
    expect(comp({ ...ALL_PASS, stock: { stock: 10, unverified: 2, completedAt: "x" } }, "stock").status).toBe("pass");
    expect(comp({ ...ALL_PASS, stock: { stock: 10, unverified: 3, completedAt: "x" } }, "stock").status).toBe("fail");
  });
});

describe("diffBrandClones", () => {
  it("equal sides → zero", () => {
    expect(diffBrandClones([{ brand: "a", clones: 3 }], [{ brand: "a", clones: 3 }])).toEqual({
      brandsCompared: 1,
      maxDiff: 0,
      brandsDiffering: 0,
    });
  });
  it("a brand present on one side only counts its whole count", () => {
    expect(
      diffBrandClones([{ brand: "a", clones: 3 }], [{ brand: "a", clones: 2 }, { brand: "b", clones: 5 }]),
    ).toEqual({ brandsCompared: 2, maxDiff: 5, brandsDiffering: 2 });
  });
});

describe("row mapping", () => {
  it("round-trips a scorecard through the v335 row shape", () => {
    const card = scoreReadiness({ ...ALL_PASS, stock: null });
    const row = toReadinessRow(card);
    expect(row.stock_status).toBe("insufficient");
    expect(row.stock_value).toBeNull();
    expect(row.precision_threshold).toBe(READINESS_THRESHOLDS.precisionMin);
    const back = fromReadinessRow({ ...row, computed_at: "2026-10-01T11:00:00Z" });
    expect(back.components.map((c) => [c.key, c.status, c.value, c.n])).toEqual(
      card.components.map((c) => [c.key, c.status, c.value, c.n]),
    );
    expect(back.components[0].reason).toBe(card.components[0].reason);
    expect(back.ready).toBe(false);
  });
  it("an unknown stored status reads as insufficient", () => {
    const row = { ...toReadinessRow(scoreReadiness(ALL_PASS)), precision_status: "maybe" };
    expect(fromReadinessRow(row).components[0].status).toBe("insufficient");
  });
});

describe("evaluateReadinessGate", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  const ok = [
    { period_month: "2026-09-01", ready: true },
    { period_month: "2026-08-01", ready: true },
  ];
  it("requires each of the last N closed months (UTC), across a year boundary", () => {
    expect(requiredMonths(now)).toEqual(["2026-09-01", "2026-08-01"]);
    expect(requiredMonths(new Date("2027-01-01T00:00:00Z"), 3)).toEqual(["2026-12-01", "2026-11-01", "2026-10-01"]);
  });
  it("opens only when every required month is present and ready", () => {
    expect(evaluateReadinessGate(ok, now)).toEqual({ ready: true, months: ["2026-09-01", "2026-08-01"] });
  });
  it("an unreadable scorecard is not ready", () => {
    expect(evaluateReadinessGate(null, now)).toMatchObject({ ready: false, reason: "scorecard_unreadable" });
  });
  it("a missing month is not ready", () => {
    expect(evaluateReadinessGate([ok[0]], now)).toMatchObject({ ready: false, reason: "not_computed:2026-08-01" });
  });
  it("a not-ready month (or a non-boolean ready) is not ready", () => {
    expect(evaluateReadinessGate([ok[0], { period_month: "2026-08-01", ready: false }], now).ready).toBe(false);
    expect(evaluateReadinessGate([ok[0], { period_month: "2026-08-01", ready: "true" }], now).ready).toBe(false);
  });
  it("older ready months do not stand in for the required ones", () => {
    const old = [
      { period_month: "2026-07-01", ready: true },
      { period_month: "2026-06-01", ready: true },
    ];
    expect(evaluateReadinessGate(old, now).ready).toBe(false);
  });
  it("a misconfigured required-months constant never opens the gate", () => {
    expect(evaluateReadinessGate(ok, now, 0).ready).toBe(false);
  });
});
