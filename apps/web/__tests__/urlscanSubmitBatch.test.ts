import { describe, expect, it, vi } from "vitest";

vi.mock("@askarthur/scam-engine/urlscan", () => ({ submitURLScanWithDetails: vi.fn() }));
vi.mock("@askarthur/scam-engine", () => ({ checkURLReputation: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => null }));

import {
  submitCandidateBatch,
  type SubmitOutcome,
} from "@/lib/clone-watch/urlscan-submit-one";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    candidate_url: `https://c${i + 1}.example`,
    candidate_domain: `c${i + 1}.example`,
  }));
const open = { expired: () => false };
const out = (kind: SubmitOutcome["kind"], reputationMalicious = false): SubmitOutcome => ({
  kind,
  reputationMalicious,
});

// The ONE outcome → counter mapping for the submit and recheck lanes.
describe("submitCandidateBatch", () => {
  it("maps every outcome kind to exactly one counter", async () => {
    const kinds: SubmitOutcome[] = [
      out("submitted"),
      out("reputation_classified", true),
      out("rate_limited"),
      out("dns_no_host"),
      out("submit_failed"),
      out("no_client"),
      out("dns_servfail"),
    ];
    const submitOne = vi.fn(async () => kinds.shift()!);
    const t = await submitCandidateBatch(rows(7), open, { submitOne });
    expect(t).toEqual({
      submitted: 2,
      rateLimited: 1,
      dnsSkipped: 1,
      dnsServfail: 1, // attempted (stamped), never a failure
      submitFailed: 2,
      reputationHits: 1,
      attemptedIds: [1, 2, 4, 5, 6, 7], // every row looked at EXCEPT the 429
      unreached: 0,
    });
  });

  it("a 429 is quota, never a failure", async () => {
    const t = await submitCandidateBatch(rows(3), open, {
      submitOne: async () => out("rate_limited"),
    });
    expect(t.submitFailed).toBe(0);
    expect(t.rateLimited).toBe(3);
    expect(t.attemptedIds).toEqual([]);
  });

  it("a thrown row counts as failed and attempted, and the loop continues", async () => {
    const onRowError = vi.fn();
    const submitOne = vi
      .fn()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValue(out("submitted"));
    const t = await submitCandidateBatch(rows(2), open, { submitOne, onRowError });
    expect(t).toMatchObject({ submitted: 1, submitFailed: 1, attemptedIds: [1, 2] });
    expect(onRowError).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("stops at the budget and reports the rows it never reached", async () => {
    let calls = 0;
    const budget = { expired: () => calls >= 2 };
    const t = await submitCandidateBatch(rows(5), budget, {
      submitOne: async () => {
        calls++;
        return out("submitted");
      },
    });
    expect(t.submitted).toBe(2);
    expect(t.unreached).toBe(3);
    expect(t.attemptedIds).toEqual([1, 2]);
  });

  // #1231 — the recheck lane submits at width 3 to fit 90 rows in its budget.
  it("honours the concurrency width and still tallies every row once", async () => {
    let inFlight = 0;
    let peak = 0;
    const submitOne = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return out("submitted");
    });
    const t = await submitCandidateBatch(rows(10), open, { submitOne, concurrency: 3 });
    expect(peak).toBe(3);
    expect(t.submitted).toBe(10);
    expect([...t.attemptedIds].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(t.unreached).toBe(0);
  });

  it("defaults to sequential (the daily submit lane is unchanged)", async () => {
    let inFlight = 0;
    let peak = 0;
    const submitOne = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return out("submitted");
    };
    await submitCandidateBatch(rows(4), open, { submitOne });
    expect(peak).toBe(1);
  });

  it("an expired budget leaves the rest unreached at any width", async () => {
    let calls = 0;
    const budget = { expired: () => calls >= 4 };
    const t = await submitCandidateBatch(rows(10), budget, {
      concurrency: 3,
      submitOne: async () => {
        calls++;
        return out("submitted");
      },
    });
    expect(t.submitted + t.unreached).toBe(10);
    expect(t.unreached).toBeGreaterThanOrEqual(5);
  });

  it("paces submit STARTS across workers (urlscan's 60/min unlisted cap)", async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const starts: number[] = [];
      const run = submitCandidateBatch(rows(6), open, {
        concurrency: 3,
        minStartIntervalMs: 1_100,
        submitOne: async () => {
          starts.push(Date.now());
          return out("submitted");
        },
      });
      await vi.runAllTimersAsync();
      const t = await run;
      expect(t.submitted).toBe(6);
      const sorted = [...starts].sort((x, y) => x - y);
      expect(sorted[0]).toBe(0);
      for (let k = 1; k < sorted.length; k++) {
        expect(sorted[k]! - sorted[k - 1]!).toBeGreaterThanOrEqual(1_100);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
