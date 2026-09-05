/**
 * One test per defect that actually shipped.
 *
 * These are not hypotheticals. Every case below is a bug that reached
 * production in one or both of the two operator backfill scripts, and the
 * reason this module exists is that they were found separately, weeks apart,
 * in code written for unrelated purposes.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockIsBraked = vi.fn(async (_feature: string) => false);
const mockLogCost = vi.fn(async (_args: unknown) => undefined);

vi.mock("../cost-log", () => ({
  isFeatureBraked: (f: string) => mockIsBraked(f),
  logCost: (a: unknown) => mockLogCost(a as never),
}));

const { runSpendingBackfill } = await import("../backfill");

function opts<T>(over: Partial<Parameters<typeof runSpendingBackfill<T>>[0]> = {}) {
  return {
    label: "test-run",
    brakeFeature: "reddit_intel",
    costFeature: "reddit-intel-take",
    provider: "anthropic",
    operation: "messages.create",
    usdPerItem: 0.001,
    items: [1, 2, 3, 4, 5] as unknown as T[],
    batchSize: 2,
    dryRun: false,
    runBatch: vi.fn(async () => ({ costUsd: 0.01, units: 100 })),
    ...over,
  } as Parameters<typeof runSpendingBackfill<T>>[0];
}

describe("runSpendingBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBraked.mockResolvedValue(false);
    process.exitCode = undefined;
  });

  it("a dry run never reaches the model", async () => {
    // BOTH scripts had the dry gate one step too low, guarding the writes
    // while the paid call went ahead. A dry run cost US$0.14 and kept nothing.
    const runBatch = vi.fn(async () => ({ costUsd: 0.01, units: 100 }));
    const r = await runSpendingBackfill(opts({ dryRun: true, runBatch }));
    expect(runBatch).not.toHaveBeenCalled();
    expect(mockLogCost).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
    expect(r.totalCostUsd).toBe(0);
  });

  it("the brake stops the run before anything is spent", async () => {
    mockIsBraked.mockResolvedValue(true);
    const runBatch = vi.fn(async () => ({ costUsd: 0.01, units: 100 }));
    const r = await runSpendingBackfill(opts({ runBatch }));
    expect(runBatch).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
  });

  it("logs cost for every batch that spent, with no way to skip it", async () => {
    // Untracked spend is invisible to the brake, to /admin/costs and to the
    // weekly digest. There is deliberately no option that turns this off, so
    // the assertion is over the count: three batches, three log calls.
    await runSpendingBackfill(opts());
    expect(mockLogCost).toHaveBeenCalledTimes(3);
    expect(mockLogCost.mock.calls[0][0]).toMatchObject({
      feature: "reddit-intel-take",
      provider: "anthropic",
      metadata: { via: "test-run" },
    });
  });

  it("one failing batch does not end the run", async () => {
    // Batch 118 of 133 threw on a malformed model response, the throw escaped
    // the loop, and 382 rows were abandoned while the totals read like a
    // finished job.
    const runBatch = vi.fn(async (_b: unknown, n: number) => {
      if (n === 2) throw new Error("expected array, received string");
      return { costUsd: 0.01, units: 100 };
    });
    const r = await runSpendingBackfill(opts({ runBatch }));
    expect(runBatch).toHaveBeenCalledTimes(3);
    expect(r.batchFailures).toBe(1);
    // 5 items at batchSize 2 = [1,2] [3,4] [5]; batch 2 fails, so 2 + 1.
    expect(r.processed).toBe(3);
    expect(mockLogCost).toHaveBeenCalledTimes(2); // never for the failed one
  });

  it("a partial run exits non-zero", async () => {
    // The failure that hid the other failure: same exit code, same final line,
    // nothing to tell "done" from "stopped early".
    const runBatch = vi.fn(async (_b: unknown, n: number) => {
      if (n === 2) throw new Error("boom");
      return { costUsd: 0.01, units: 100 };
    });
    await runSpendingBackfill(opts({ runBatch }));
    expect(process.exitCode).toBe(1);
  });

  it("a complete run leaves the exit code alone", async () => {
    await runSpendingBackfill(opts());
    expect(process.exitCode).toBeUndefined();
  });

  it("reports the cost the batch actually incurred, not the estimate", async () => {
    // usdPerItem is for the dry projection only. Reporting it as real spend
    // would make cost_telemetry agree with itself and disagree with the bill.
    const runBatch = vi.fn(async () => ({ costUsd: 0.5, units: 100 }));
    const r = await runSpendingBackfill(
      opts({ runBatch, usdPerItem: 0.000001 }),
    );
    expect(r.totalCostUsd).toBeCloseTo(1.5, 5);
    expect(mockLogCost.mock.calls[0][0]).toMatchObject({
      estimatedCostUsd: 0.5,
    });
  });
});
