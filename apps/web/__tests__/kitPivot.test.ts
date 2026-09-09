import { describe, expect, it } from "vitest";
import {
  noIpKitSiblings,
  runKitPivots,
  shapeKitSiblings,
  type KitPivotRow,
} from "@/lib/clone-watch/kit-pivot";

const AT = new Date("2026-07-17T00:00:00.000Z");

describe("shapeKitSiblings", () => {
  it("dedups, excludes self, caps at 20, preserves last_seen", () => {
    const hits = [
      {
        domain: "nab-login.shop",
        url: "https://nab-login.shop/",
        lastSeen: "2026-07-16T00:00:00Z",
      }, // self
      {
        domain: "nab-secure.shop",
        url: null,
        lastSeen: "2026-07-15T00:00:00Z",
      },
      {
        domain: "NAB-SECURE.shop",
        url: null,
        lastSeen: "2026-07-14T00:00:00Z",
      }, // dup (case)
      { domain: "westpac-login.shop", url: null, lastSeen: null },
    ];
    const b = shapeKitSiblings("nab-login.shop", "203.0.113.7", hits, AT);
    expect(b.pivot).toBe("ip");
    expect(b.pivot_value).toBe("203.0.113.7");
    expect(b.siblings.map((s) => s.domain)).toEqual([
      "nab-secure.shop",
      "westpac-login.shop",
    ]);
    expect(b.result_count).toBe(4);
    expect(b.searched_at).toBe(AT.toISOString());
  });

  it("ALWAYS returns a block even with zero siblings (predicate-crossing rule)", () => {
    const b = shapeKitSiblings("nab-login.shop", "203.0.113.7", [], AT);
    expect(b.siblings).toEqual([]);
    expect(b.result_count).toBe(0);
    // A block is written so the row leaves the kit_siblings-IS-NULL worklist.
    expect(b.pivot_value).toBe("203.0.113.7");
  });

  it("noIpKitSiblings: a sentinel block so a no-IP row crosses the worklist predicate", () => {
    const b = noIpKitSiblings(AT);
    expect(b.pivot_value).toBeNull();
    expect(b.reason).toBe("no_ip");
    expect(b.siblings).toEqual([]);
    expect(b.result_count).toBe(0);
    expect(b.searched_at).toBe(AT.toISOString());
  });

  it("caps siblings at 20", () => {
    const hits = Array.from({ length: 30 }, (_, i) => ({
      domain: `sib${i}.shop`,
      url: null,
      lastSeen: null,
    }));
    const b = shapeKitSiblings("self.shop", "1.1.1.1", hits, AT);
    expect(b.siblings.length).toBe(20);
    expect(b.result_count).toBe(30);
  });
});

/**
 * The kit-pivot loop must account for every candidate it was handed.
 *
 * WHAT THIS COSTS WHEN IT IS MISSING. #1131 gave this loop a Write Outcome and
 * still returned `deadlineHit: false` with `notReachedQuota` in a log line
 * only. On a urlscan 429 at row 3 of 10 the caller saw `attempted 10,
 * written 3, failed 0` — a seven-row gap with no field explaining it, which is
 * the silent drop the Write Outcome exists to prevent, wearing its type.
 * CONTEXT.md permits a gap only where "the site says so", and a log line is
 * not the shape a consumer reads.
 *
 * These call the loop rather than grepping it, which is only possible because
 * #1136 extracted the decision out of the Inngest step
 * (docs/agents/defect-shapes.md shape N).
 *
 * Go-red: drop `notReachedQuota` from the return, or remove the per-row
 * budget check.
 */
const AMPLE = { expired: () => false, remainingMs: () => 60_000 };
const SPENT = { expired: () => true, remainingMs: () => 0 };

function rows(n: number, opts: { ip?: string | null } = {}): KitPivotRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    candidate_domain: `clone-${i}.shop`,
    urlscan_evidence:
      opts.ip === null ? null : { server: { ip: opts.ip ?? "203.0.113.7" } },
    attribution: { whois: {} },
  }));
}

const okSearch = async () => ({ ok: true as const, results: [], total: 0 });
const okWrite = async () => ({ ok: true });

/** Every candidate lands in exactly one bucket. */
function expectFullyAccounted(o: {
  attempted: number;
  written: number;
  failed: number;
  notReachedQuota: number;
  notReachedBudget: number;
}) {
  expect(
    o.attempted - o.written - o.failed - o.notReachedQuota - o.notReachedBudget,
  ).toBe(0);
}

describe("runKitPivots accounts for every candidate", () => {
  it("writes each row on the happy path", async () => {
    const o = await runKitPivots({
      rows: rows(3),
      budget: AMPLE,
      search: okSearch,
      write: okWrite,
    });
    expect(o).toMatchObject({
      attempted: 3,
      written: 3,
      failed: 0,
      notReachedQuota: 0,
      notReachedBudget: 0,
      deadlineHit: false,
    });
    expectFullyAccounted(o);
  });

  it("abandons the rest of the batch on a 429 and counts it as quota, not failure", async () => {
    // A 429 is quota exhaustion, not evidence about the row — booking it as a
    // failure would mark rows bad that were never looked at. And the abandon
    // must be sequential: parallelising breaks the semantic
    // (docs/ops/inngest-slot-budget.md).
    let calls = 0;
    const o = await runKitPivots({
      rows: rows(10),
      budget: AMPLE,
      search: async () => {
        calls += 1;
        return calls > 3
          ? { ok: false as const, error: "rate_limited" as const }
          : { ok: true as const, results: [], total: 0 };
      },
      write: okWrite,
    });
    expect(o.written).toBe(3);
    expect(o.failed).toBe(0);
    expect(o.notReachedQuota).toBe(7);
    expectFullyAccounted(o);
  });

  it("counts a transient search error as a failure of this run", async () => {
    const o = await runKitPivots({
      rows: rows(2),
      budget: AMPLE,
      search: async () => ({
        ok: false as const,
        error: "http_error" as const,
      }),
      write: okWrite,
    });
    expect(o.failed).toBe(2);
    expect(o.notReachedQuota).toBe(0);
    expectFullyAccounted(o);
  });

  it("stops on an expired budget and counts what it never reached", async () => {
    const o = await runKitPivots({
      rows: rows(5),
      budget: SPENT,
      search: okSearch,
      write: okWrite,
    });
    expect(o.notReachedBudget).toBe(5);
    expect(o.written).toBe(0);
    expect(o.deadlineHit).toBe(true);
    expectFullyAccounted(o);
  });

  it("writes the no-IP sentinel without spending a search", async () => {
    // The row must still cross the kit_siblings-IS-NULL predicate or it is
    // re-selected forever — the op-review "cross the predicate you filter on"
    // rule.
    let searched = 0;
    const written: unknown[] = [];
    const o = await runKitPivots({
      rows: rows(2, { ip: null }),
      budget: AMPLE,
      search: async () => {
        searched += 1;
        return { ok: true as const, results: [], total: 0 };
      },
      write: async (_row, block) => {
        written.push(block);
        return { ok: true };
      },
    });
    expect(searched).toBe(0);
    expect(o.written).toBe(2);
    expect(written[0]).toMatchObject({ reason: "no_ip", pivot_value: null });
    expectFullyAccounted(o);
  });

  it("counts a failed write as failed, not written", async () => {
    const o = await runKitPivots({
      rows: rows(2),
      budget: AMPLE,
      search: okSearch,
      write: async () => ({ ok: false }),
    });
    expect(o.written).toBe(0);
    expect(o.failed).toBe(2);
    expectFullyAccounted(o);
  });
});
