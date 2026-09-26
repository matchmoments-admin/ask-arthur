// The monthly readiness step can never fail the report run (#1260 review L2).
//
// Two levels, both tested:
//   - computeAndRecordReadiness (the step body) catches everything and bounds
//     the compute by a wall clock, returning a degraded result — and never
//     writes a row after its clock ran out;
//   - clone-watch-report-summary runs the step AFTER log-outcome and catches a
//     failure the step itself cannot (a platform timeout exhausting retries),
//     so the Outcome Row and the month's report survive.
//
// Go-red record (2026-09-27, guard broken → test failed → restored):
//   - step body: removed the try/catch (rethrow)
//        → "a compute that throws is degraded, not thrown" FAILED
//   - step body: removed the Promise.race wall clock
//        → "a compute that outruns the wall clock is degraded and writes nothing" FAILED
//   - handler: removed the try/catch around step.run("compute-readiness")
//        → "a failing readiness step does not fail the run …" FAILED
//   - handler: moved compute-readiness back BEFORE log-outcome
//        → "… and runs after log-outcome" FAILED

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  order: [] as string[],
  laneOutcome: vi.fn(async () => {
    m.order.push("log-outcome");
  }),
  readinessStep: vi.fn(),
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: { createFunction: (_c: unknown, _t: unknown, h: unknown) => h },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, h: unknown) => h,
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ is: async () => ({ data: [], error: null }) }) }),
  }),
}));
vi.mock("@askarthur/scam-engine/active-watchlist", () => ({ getActiveWatchlist: async () => [] }));
vi.mock("@/lib/clone-watch/record-coverage", () => ({
  planCoverageSync: () => ({ toAdd: [], toClose: [], unchanged: 0 }),
  logCoverageChange: () => {},
}));
vi.mock("@/lib/clone-watch/monthly-brand-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/clone-watch/monthly-brand-store")>()),
  // A frozen month: the summary step returns early, no heavy mocks needed.
  readMonthFrozenAt: async () => "2026-09-01T11:02:00Z",
}));
vi.mock("@askarthur/scam-engine/lane-outcome", async (orig) => ({
  ...(await orig<typeof import("@askarthur/scam-engine/lane-outcome")>()),
  recordLaneOutcome: m.laneOutcome,
}));
vi.mock("@/lib/clone-watch/readiness-data", async (orig) => ({
  ...(await orig<typeof import("@/lib/clone-watch/readiness-data")>()),
  computeAndRecordReadiness: (...a: unknown[]) => m.readinessStep(...a),
}));

import { cloneWatchReportSummary } from "@/app/api/inngest/functions/clone-watch-report-summary";
import type { Scorecard } from "@/lib/clone-watch/readiness";

// The mock above replaces the module export; reach the real one for the body tests.
const real = (await vi.importActual<typeof import("@/lib/clone-watch/readiness-data")>(
  "@/lib/clone-watch/readiness-data",
)).computeAndRecordReadiness;

const card: Scorecard = { periodMonth: "2026-09-01", components: [], ready: false };
const sb = {} as never;

describe("computeAndRecordReadiness — the step body", () => {
  it("writes and reports on success", async () => {
    const write = vi.fn(async () => {});
    const out = await real("2026-09", { client: () => sb, compute: async () => card, write });
    expect(out).toEqual({ ready: false, statuses: {} });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a compute that throws is degraded, not thrown", async () => {
    const out = await real("2026-09", {
      client: () => sb,
      compute: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toEqual({ errored: "compute_or_write_failed" });
  });

  it("a write that throws is degraded, not thrown", async () => {
    const out = await real("2026-09", {
      client: () => sb,
      compute: async () => card,
      write: async () => {
        throw new Error("permission denied");
      },
    });
    expect(out).toEqual({ errored: "compute_or_write_failed" });
  });

  it("a compute that outruns the wall clock is degraded and writes nothing", async () => {
    const write = vi.fn(async () => {});
    const out = await real("2026-09", {
      client: () => sb,
      compute: () => new Promise<Scorecard>((r) => setTimeout(() => r(card), 200)),
      write,
      wallClockMs: 10,
    });
    expect(out).toEqual({ errored: "timeout" });
    await new Promise((r) => setTimeout(r, 250));
    expect(write).not.toHaveBeenCalled();
  });

  it("no client is degraded", async () => {
    expect(await real("2026-09", { client: () => null })).toEqual({ errored: "supabase_unavailable" });
  });
});

type Handler = (ctx: unknown) => Promise<Record<string, unknown>>;
const run = () =>
  (cloneWatchReportSummary as unknown as Handler)({
    event: { name: "clone-watch/report-summary.manual-trigger.v1", data: { periodMonth: "2026-09" } },
    step: {
      run: async (id: string, f: () => unknown) => {
        m.order.push(id);
        if (id === "compute-readiness") {
          // What Inngest surfaces when the step's retries are exhausted.
          throw new Error("step compute-readiness failed: FUNCTION_INVOCATION_TIMEOUT");
        }
        return f();
      },
      sendEvent: vi.fn(),
    },
  });

describe("clone-watch-report-summary — the readiness step", () => {
  beforeEach(() => {
    m.order.length = 0;
    vi.clearAllMocks();
  });

  it("a failing readiness step does not fail the run, and runs after log-outcome", async () => {
    const out = await run();
    expect(out.ok).toBe(true);
    expect(out.readiness).toEqual({ errored: "step_failed" });
    expect(m.laneOutcome).toHaveBeenCalledTimes(1);
    const at = (id: string) => m.order.indexOf(id);
    expect(at("log-outcome")).toBeGreaterThanOrEqual(0);
    expect(at("compute-readiness")).toBeGreaterThan(at("log-outcome"));
  });
});
