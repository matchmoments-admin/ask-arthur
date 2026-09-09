import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The pager's declared boundary count is DERIVED from MAX_PAGES, and nothing
 * else links them.
 *
 * `inngest-finish-budget: 43 boundaries` is a comment. `MAX_PAGES` is a
 * constant. The finish-budget floor test reads the comment and never the
 * constant, so raising MAX_PAGES leaves the declaration — and therefore the
 * whole circuit breaker — describing a run that no longer exists. Caught by
 * go-red while adding the budget (#1139): restoring the old MAX_PAGES = 1000
 * changed the real worst case from 40 boundaries to 2,000 and no test moved.
 *
 * WHY MAX_PAGES IS SMALL. The loop spends TWO step boundaries per page, so the
 * old 1000-page runaway guard implied 2,000 boundaries — an honest finish
 * timeout for that is about sixteen hours, which is not a circuit breaker.
 * 20 pages x PAGE_SIZE (100) = 2,000 monitors, against a feature with zero
 * lifetime usage (NORTH_STAR.md — Phone Footprint is mothballed).
 *
 * Reads the source rather than importing: importing pulls the whole
 * Inngest/Supabase chain in for what is a static invariant, which is the same
 * choice cloneWatchUrlscanSubmit.test.ts makes.
 */
const SRC = readFileSync(
  new URL(
    "../app/api/inngest/functions/phone-footprint-vonage-backfill.ts",
    import.meta.url,
  ),
  "utf8",
);

const num = (re: RegExp, label: string): number => {
  const m = re.exec(SRC);
  expect(m, `could not find ${label}`).not.toBeNull();
  return Number(m![1]!.replace(/_/g, ""));
};

describe("phone-footprint vonage backfill capacity invariants", () => {
  const maxPages = () => num(/const MAX_PAGES = (\d+);/, "MAX_PAGES");
  const declared = () =>
    num(/inngest-finish-budget:\s*(\d+)\s*boundaries/, "boundary declaration");

  it("declares at least the boundaries the pager can actually reach", () => {
    // Two step.run sites per page (`page-N` then `emit-N`), plus the sibling
    // monitor function's 3 static steps — the floor test reads one
    // declaration per function and this file's first one has to cover the
    // pager, which dominates.
    const MONITOR_STATIC_STEPS = 3;
    const pagerWorstCase = maxPages() * 2;
    expect(
      declared(),
      `MAX_PAGES is ${maxPages()}, so the pager can reach ${pagerWorstCase} ` +
        `boundaries; the declaration says ${declared()}. Raising MAX_PAGES ` +
        `without raising the declaration leaves the finish timeout describing ` +
        `a run that no longer exists.`,
    ).toBeGreaterThanOrEqual(pagerWorstCase + MONITOR_STATIC_STEPS);
  });

  it("keeps the page ceiling inside what a finish timeout can honestly cover", () => {
    // 2 boundaries/page x 30s queue wait each. Past roughly this point the
    // derived finish stops being a breaker and the loop needs a resumable
    // cursor instead of a bigger number.
    const QUEUE_WAIT_S = 30;
    const derivedFinishSeconds = maxPages() * 2 * QUEUE_WAIT_S;
    expect(derivedFinishSeconds).toBeLessThanOrEqual(30 * 60);
  });

  it("reports rather than silently truncates when the cap is hit", () => {
    // Stopping mid-pagination skips monitors, and this function is fired by an
    // operator event — nothing picks the remainder up. It must say so.
    expect(SRC).toMatch(/truncated/);
    expect(SRC).toMatch(/page cap reached/);
  });
});
