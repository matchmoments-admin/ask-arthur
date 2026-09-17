import { describe, expect, it, vi } from "vitest";

import { runStalenessSweep, stalenessRpcBatch } from "../staleness-sweep";

/**
 * Behavioural tests for the Staleness Sweep loop (#1156, v308).
 *
 * Go-red record (each reinstated, watched fail, then reverted):
 *   - "stops on a short batch": make the loop ignore `deactivated < batchLimit`
 *     → it runs to maxBatches (200 calls instead of 2).
 *   - "budget checked BEFORE each batch": move the `expired()` check after
 *     `runBatch` → an already-expired budget still runs one batch. That is the
 *     shape that cancelled the recheck lane at index 0 (#1124): a loop that
 *     does work first and asks afterwards.
 *   - "never throws for out-of-time": throw on expiry → the tail is never
 *     reported as `drained:false`, and Inngest retries identical work.
 *   - "RPC error surfaces the message": return `{deactivated:0}` on error →
 *     a broken RPC reads as a drained sweep.
 */

const live = { expired: () => false, remainingMs: () => 60_000 };
const dead = { expired: () => true, remainingMs: () => 0 };

function batches(sizes: number[]) {
  const fn = vi.fn();
  for (const n of sizes) fn.mockResolvedValueOnce({ deactivated: n });
  // Anything past the scripted sizes is a bug in the loop, make it loud.
  fn.mockRejectedValue(new Error("unexpected extra batch"));
  return fn;
}

describe("runStalenessSweep", () => {
  it("stops on a short batch and reports drained", async () => {
    const runBatch = batches([2000, 2000, 731]);
    const r = await runStalenessSweep({
      budget: live,
      runBatch,
      batchLimit: 2000,
    });
    expect(r).toEqual({
      deactivated: 4731,
      batches: 3,
      drained: true,
      budgetExpired: false,
    });
    expect(runBatch).toHaveBeenCalledTimes(3);
  });

  it("a zero batch is a drained sweep, not a loop", async () => {
    const runBatch = batches([0]);
    const r = await runStalenessSweep({
      budget: live,
      runBatch,
      batchLimit: 5000,
    });
    expect(r.drained).toBe(true);
    expect(r.batches).toBe(1);
  });

  it("checks the budget BEFORE each batch and never throws for out-of-time", async () => {
    const runBatch = batches([2000, 2000, 2000]);
    let calls = 0;
    // Expires after the second batch has been counted.
    const budget = {
      expired: () => calls++ >= 2,
      remainingMs: () => 0,
    };
    const r = await runStalenessSweep({ budget, runBatch, batchLimit: 2000 });
    expect(runBatch).toHaveBeenCalledTimes(2);
    expect(r).toEqual({
      deactivated: 4000,
      batches: 2,
      drained: false,
      budgetExpired: true,
    });
  });

  it("an already-expired budget runs zero batches", async () => {
    const runBatch = batches([2000]);
    const r = await runStalenessSweep({
      budget: dead,
      runBatch,
      batchLimit: 2000,
    });
    expect(runBatch).not.toHaveBeenCalled();
    expect(r).toEqual({
      deactivated: 0,
      batches: 0,
      drained: false,
      budgetExpired: true,
    });
  });

  it("maxBatches is a runaway backstop, reported as not drained", async () => {
    const runBatch = vi.fn().mockResolvedValue({ deactivated: 10 });
    const r = await runStalenessSweep({
      budget: live,
      runBatch,
      batchLimit: 10,
      maxBatches: 3,
    });
    expect(runBatch).toHaveBeenCalledTimes(3);
    expect(r.drained).toBe(false);
    expect(r.budgetExpired).toBe(false);
  });

  it("rejects a non-positive batchLimit before calling anything", async () => {
    const runBatch = batches([]);
    await expect(
      runStalenessSweep({ budget: live, runBatch, batchLimit: 0 }),
    ).rejects.toThrow(/batchLimit/);
    expect(runBatch).not.toHaveBeenCalled();
  });
});

describe("stalenessRpcBatch", () => {
  it("maps deactivated_count and passes the RPC args through", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { deactivated_count: 42, batch_limit: 2000 },
      error: null,
    });
    const run = stalenessRpcBatch({ rpc }, "mark_stale_urls", {
      p_stale_days: 7,
      p_limit: 2000,
    });
    await expect(run()).resolves.toEqual({ deactivated: 42 });
    expect(rpc).toHaveBeenCalledWith("mark_stale_urls", {
      p_stale_days: 7,
      p_limit: 2000,
    });
  });

  it("surfaces an RPC error by message instead of reading as drained", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: "canceling statement due to statement timeout",
        code: "57014",
      },
    });
    const run = stalenessRpcBatch({ rpc }, "mark_stale_ips", {
      p_stale_days: 7,
      p_limit: 5000,
    });
    await expect(run()).rejects.toThrow(/mark_stale_ips RPC failed: canceling/);
  });
});
