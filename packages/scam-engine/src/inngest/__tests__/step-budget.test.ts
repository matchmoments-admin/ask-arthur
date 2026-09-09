import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  budgetedStep,
  IN_STEP_BUDGET_SHARE,
  MAX_IN_STEP_WALL_CLOCK_MS,
  ROUTE_MAX_DURATION_S,
  spanningBudget,
} from "../step-budget";

/**
 * Behavioural tests for the Step Budget Module — these CALL the constructors
 * with the inputs that used to break the guards, rather than grepping for
 * idioms (docs/agents/defect-shapes.md, shape N).
 *
 * Go-red record:
 *   - "degrades … warns once": replace the degraded branch with `?? 0`
 *     semantics (deadline = 0 + wallClockMs) → expired() is immediately true.
 *   - "origin is step entry": move the makeBudget call in budgetedStep outside
 *     the step.run callback → remainingMs is 100 s short.
 *   - "ceiling": drop the MAX_IN_STEP_WALL_CLOCK_MS check → resolves.
 */

const warn = vi.fn();
const log = { warn };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:10:00Z"));
  warn.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("spanningBudget — measured from event.ts", () => {
  it("is expired when the trigger is older than the budget", () => {
    const b = spanningBudget(
      { event: { ts: Date.now() - 10_000 } },
      5_000,
      log,
    );
    expect(b.kind).toBe("spanning");
    expect(b.degraded).toBe(false);
    expect(b.expired()).toBe(true);
    expect(b.remainingMs()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is not expired when the trigger is recent, and counts down from ts", () => {
    const ts = Date.now() - 10_000;
    const b = spanningBudget({ event: { ts } }, 60_000, log);
    expect(b.expired()).toBe(false);
    expect(b.remainingMs()).toBe(50_000);
    expect(b.deadlineAt).toBe(ts + 60_000);
  });

  it("survives a replay: the same event.ts yields the same deadline later", () => {
    // The whole reason for event.ts as origin. A handler re-executed 200 s
    // later must construct a budget with the SAME deadline, not a fresh one.
    const ts = Date.now();
    const first = spanningBudget({ event: { ts } }, 300_000, log);
    vi.advanceTimersByTime(200_000);
    const replay = spanningBudget({ event: { ts } }, 300_000, log);
    expect(replay.deadlineAt).toBe(first.deadlineAt);
    expect(replay.remainingMs()).toBe(100_000);
  });

  it.each([
    ["absent event", { event: undefined }],
    ["absent ts", { event: {} }],
    ["negative ts", { event: { ts: -1 } }],
    ["zero ts", { event: { ts: 0 } }],
    ["NaN ts", { event: { ts: Number.NaN } }],
  ])(
    "degrades to a segment clock and warns once when ts is unusable (%s)",
    (_label, ctx) => {
      const b = spanningBudget(ctx, 30_000, log);
      expect(b.degraded).toBe(true);
      expect(b.kind).toBe("spanning");
      // A confident zero would make this true immediately — the #1129 A1
      // defect. A segment clock gives the full budget from construction.
      expect(b.expired()).toBe(false);
      expect(b.deadlineAt).toBe(Date.now() + 30_000);
      expect(warn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(30_000);
      expect(b.expired()).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it("treats a future-dated ts as unusable rather than granting extra time", () => {
    const b = spanningBudget(
      { event: { ts: Date.now() + 60_000 } },
      30_000,
      log,
    );
    expect(b.degraded).toBe(true);
    expect(b.deadlineAt).toBe(Date.now() + 30_000);
  });

  it("rejects a non-positive budget", () => {
    expect(() => spanningBudget({ event: { ts: Date.now() } }, 0, log)).toThrow(
      /positive/,
    );
  });
});

describe("budgetedStep — the origin is step entry, by construction", () => {
  // A fake step whose scheduler delays the callback, as a queued slot would.
  const delayedStep = (delayMs: number) => ({
    run: async (_id: string, fn: () => Promise<unknown>) => {
      vi.advanceTimersByTime(delayMs);
      return fn();
    },
  });

  it("hands the callback a budget measured from when the callback starts", async () => {
    // 100 s of queue wait before the step body runs must NOT come out of the
    // body's budget — that is the persistAssignments default-parameter defect
    // in reverse, and the property the whole constructor exists to hold.
    const seen = await budgetedStep(
      delayedStep(100_000),
      "cluster-batch",
      240_000,
      async (budget) => ({
        kind: budget.kind,
        remainingMs: budget.remainingMs(),
        degraded: budget.degraded,
      }),
    );
    expect(seen).toEqual({
      kind: "in-step",
      remainingMs: 240_000,
      degraded: false,
    });
  });

  it("returns the callback's result through the step", async () => {
    const step = {
      run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
    };
    const r = await budgetedStep(step, "x", 1_000, async () => ({ n: 7 }));
    expect(r).toEqual({ n: 7 });
    expect(step.run).toHaveBeenCalledWith("x", expect.any(Function));
  });

  it("expires inside the callback once the budget elapses", async () => {
    await budgetedStep(delayedStep(0), "x", 10_000, async (budget) => {
      expect(budget.expired()).toBe(false);
      vi.advanceTimersByTime(10_000);
      expect(budget.expired()).toBe(true);
      expect(budget.remainingMs()).toBe(0);
    });
  });

  it("refuses a budget above the route's ceiling before scheduling the step", () => {
    const step = { run: vi.fn() };
    expect(() =>
      budgetedStep(
        step,
        "too-big",
        MAX_IN_STEP_WALL_CLOCK_MS + 1,
        async () => 1,
      ),
    ).toThrow(/exceeds the in-step ceiling/);
    expect(step.run).not.toHaveBeenCalled();
  });

  it("derives the ceiling from the one route copy", () => {
    expect(MAX_IN_STEP_WALL_CLOCK_MS).toBe(
      Math.floor(ROUTE_MAX_DURATION_S * 1000 * IN_STEP_BUDGET_SHARE),
    );
    expect(
      ROUTE_MAX_DURATION_S * 1000 - MAX_IN_STEP_WALL_CLOCK_MS,
    ).toBeGreaterThan(30_000);
  });
});
