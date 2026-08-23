import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * v285 — the urlscan submit lane's three capacity numbers are coupled, and
 * getting them out of step fails SILENTLY (the lane just does less work than
 * its constant claims, which is the exact defect class v284/v285 exist to fix:
 * 924 alerts never scanned, discovered only by querying prod).
 *
 * These read the source rather than importing the module, because importing it
 * pulls in the whole Inngest/Supabase chain for what is a static invariant.
 */
describe("clone-watch urlscan submit capacity invariants", () => {
  const SRC = readFileSync(
    new URL(
      "../app/api/inngest/functions/clone-watch-urlscan-submit.ts",
      import.meta.url,
    ),
    "utf8",
  );

  const num = (re: RegExp, label: string): number => {
    const m = re.exec(SRC);
    expect(m, `could not find ${label}`).not.toBeNull();
    return Number(m![1].replace(/_/g, ""));
  };

  const batchLimit = () => num(/const SUBMIT_BATCH_LIMIT = (\d+)/, "SUBMIT_BATCH_LIMIT");
  const wallClockMs = () =>
    num(/const SUBMIT_WALL_CLOCK_MS = ([\d_]+)/, "SUBMIT_WALL_CLOCK_MS");
  const finishMs = () => num(/timeouts: \{ finish: "(\d+)m" \}/, "finish timeout") * 60_000;

  it("one run cannot exhaust the urlscan daily quota by itself", () => {
    // Real entitlement, measured 2026-08-23 (the docs had claimed 100/day,
    // unverified, for months): unlisted 1,000/day. The recheck lane already
    // consumes ~210. A single submit run must stay well inside what remains.
    //
    // NOTE the fn-level `throttle` is deliberately NOT asserted against here.
    // Throttle caps RUNS per period, not submissions (docs/inngest-brakes.md
    // §glossary) — one run submits up to SUBMIT_BATCH_LIMIT rows — so any
    // comparison between the two is a units error. An earlier version of this
    // test made exactly that mistake. The honest statement of the daily
    // ceiling is "SUBMIT_BATCH_LIMIT per cron fire"; there is no true
    // per-day submission budget in this lane (see the ops doc).
    const URLSCAN_UNLISTED_DAILY = 1_000;
    const RECHECK_LANE_DAILY = 210;
    expect(batchLimit()).toBeLessThan(URLSCAN_UNLISTED_DAILY - RECHECK_LANE_DAILY);
  });

  it("leaves the wall-clock guard strictly inside the finish budget", () => {
    // The guard exists so a slow batch breaks cleanly and drains next tick
    // rather than replaying the whole step (which would re-POST to urlscan).
    // It only works if it fires BEFORE Inngest cancels the run.
    expect(wallClockMs()).toBeLessThan(finishMs());
  });

  it("keeps the dormant horizon aligned with the worklist's 90-day window", () => {
    // The v285 worklist admits `first_seen_at >= now() - 90 days`; the sweep
    // retires `< now() - horizon`. They must be the same number or rows are
    // either retired while still eligible, or fall in a gap and vanish
    // silently — the very failure this migration removed.
    expect(num(/const DORMANT_HORIZON_DAYS = (\d+)/, "DORMANT_HORIZON_DAYS")).toBe(90);
  });
});
