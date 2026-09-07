import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withAxiomLogging } from "../with-axiom-logging";
import * as axiomLogger from "@askarthur/utils/axiom-logger";

// With FF_AXIOM_ENABLED unset, getLogger() returns a NOOP logger, so these
// tests exercise the HOF's wrapping/passthrough contract without needing
// Axiom credentials or network. The free-tier kill switch is itself covered
// by axiom-logger's own tests in @askarthur/utils.

// The HOF is typed against Inngest's full handler context (GetFunctionInput),
// which is huge. Tests only exercise the three fields the HOF reads
// (event.data.requestId, runId, attempt), so we cast partial fixtures through
// `unknown` to the handler's real parameter type.
type HandlerCtx = Parameters<ReturnType<typeof withAxiomLogging<unknown>>>[0];
const ctx = (partial: {
  event?: { data?: Record<string, unknown>; ts?: number };
  runId?: string;
  attempt?: number;
}): HandlerCtx => partial as unknown as HandlerCtx;

describe("withAxiomLogging", () => {
  beforeEach(() => {
    delete process.env.FF_AXIOM_ENABLED;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the handler's result unchanged", async () => {
    const handler = vi.fn(async () => ({ ok: true, n: 42 }));
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, handler);
    const result = await wrapped(ctx({ runId: "run_1", attempt: 0 }));
    expect(result).toEqual({ ok: true, n: 42 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("passes the full ctx through to the handler", async () => {
    const input = ctx({
      event: { data: { requestId: "req_abc" } },
      runId: "run_2",
      attempt: 1,
    });
    const handler = vi.fn(async (received: HandlerCtx) => received.runId);
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, handler);
    const result = await wrapped(input);
    expect(handler).toHaveBeenCalledWith(input);
    expect(result).toBe("run_2");
  });

  it("re-throws handler errors (so Inngest still records the failure)", async () => {
    const boom = new Error("kaboom");
    const handler = vi.fn(async () => {
      throw boom;
    });
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, handler);
    await expect(wrapped(ctx({ runId: "run_3" }))).rejects.toThrow("kaboom");
  });

  it("does not throw when the event carries no requestId (cron path)", async () => {
    const handler = vi.fn(async () => "done");
    const wrapped = withAxiomLogging({ fnId: "cron-fn" }, handler);
    // No event at all — cron functions fall back to runId.
    await expect(wrapped(ctx({ runId: "run_4" }))).resolves.toBe("done");
    // Even with a totally absent runId it must not blow up.
    await expect(wrapped(ctx({}))).resolves.toBe("done");
  });
});

describe("withAxiomLogging — production-only cron guard", () => {
  const cronCtx = (): HandlerCtx =>
    ({
      event: { name: "inngest/scheduled.timer" },
      runId: "run_c",
    }) as unknown as HandlerCtx;

  beforeEach(() => {
    delete process.env.FF_AXIOM_ENABLED;
    delete process.env.VERCEL_ENV;
    delete process.env.INNGEST_ALLOW_NONPROD_CRONS;
  });
  afterEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.INNGEST_ALLOW_NONPROD_CRONS;
    vi.restoreAllMocks();
  });

  it("skips a cron tick on a non-production deployment", async () => {
    process.env.VERCEL_ENV = "preview";
    const handler = vi.fn(async () => "ran");
    const wrapped = withAxiomLogging({ fnId: "cron-fn" }, handler);
    const result = await wrapped(cronCtx());
    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: true, reason: "non_production_cron" });
  });

  it("runs a cron tick on the production deployment", async () => {
    process.env.VERCEL_ENV = "production";
    const handler = vi.fn(async () => "ran");
    const wrapped = withAxiomLogging({ fnId: "cron-fn" }, handler);
    await expect(wrapped(cronCtx())).resolves.toBe("ran");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("runs a non-prod cron tick when INNGEST_ALLOW_NONPROD_CRONS=true", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.INNGEST_ALLOW_NONPROD_CRONS = "true";
    const handler = vi.fn(async () => "ran");
    const wrapped = withAxiomLogging({ fnId: "cron-fn" }, handler);
    await expect(wrapped(cronCtx())).resolves.toBe("ran");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never skips event/manual triggers off-prod (only scheduled.timer)", async () => {
    process.env.VERCEL_ENV = "preview";
    const handler = vi.fn(async () => "ran");
    const wrapped = withAxiomLogging({ fnId: "evt-fn" }, handler);
    const evtCtx = {
      event: { name: "known-brands/discover.manual-trigger.v1" },
      runId: "run_e",
    } as unknown as HandlerCtx;
    await expect(wrapped(evtCtx)).resolves.toBe("ran");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/**
 * fn.complete must report the RUN's elapsed time, not the last replay segment.
 *
 * The field this replaces, `durationMs`, was `Date.now() - <handler entry>`.
 * Inngest re-executes the handler body from the top at every step boundary, so
 * that timestamp resets on each replay and the field only ever measured the
 * final segment. Over seven days of production almost every function reported
 * avg=1ms — including reddit-intel-cluster, which was directly observed holding
 * a slot for minutes on 2026-09-07 (0.87s per post x 500 posts). A field named
 * "duration" that reads 1ms for a seven-minute run is worse than no field.
 *
 * These assertions INVOKE the wrapper and read what actually reached the log
 * call, rather than checking the source for a token — see
 * docs/agents/defect-shapes.md shape N.
 */
describe("fn.complete reports true elapsed time, not the final replay segment", () => {
  const logged: Array<{ msg: string; fields: Record<string, unknown> }> = [];

  beforeEach(() => {
    logged.length = 0;
    process.env.FF_AXIOM_ENABLED = "true";
    vi.spyOn(axiomLogger, "getLogger").mockReturnValue({
      info: (msg: string, fields: Record<string, unknown>) =>
        logged.push({ msg, fields }),
      warn: () => {},
      error: (msg: string, fields: Record<string, unknown>) =>
        logged.push({ msg, fields }),
      debug: () => {},
      flush: async () => {},
    } as unknown as ReturnType<typeof axiomLogger.getLogger>);
  });

  const complete = () => logged.find((l) => l.msg === "fn.complete")!.fields;

  it("measures from the event's trigger timestamp, which survives replay", async () => {
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");
    await wrapped(
      ctx({ event: { ts: Date.now() - 60_000 }, runId: "r", attempt: 0 }),
    );

    const elapsed = complete()["elapsedSinceTriggerMs"] as number;
    // ~60s. The old implementation would report single-digit ms here, because
    // the handler itself is instantaneous — that is the whole defect.
    expect(elapsed).toBeGreaterThan(55_000);
    expect(elapsed).toBeLessThan(70_000);
  });

  it("reports null — not 0 — when the event carries no ts", async () => {
    // `ts` is optional in Inngest's EventPayload. A confident zero is exactly
    // the failure mode this change exists to remove.
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");
    await wrapped(ctx({ runId: "r", attempt: 0 }));

    expect(complete()["elapsedSinceTriggerMs"]).toBeNull();
  });

  it("reports null for a future-dated or clock-skewed ts", async () => {
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");
    await wrapped(ctx({ event: { ts: Date.now() + 60_000 }, runId: "r" }));

    expect(complete()["elapsedSinceTriggerMs"]).toBeNull();
  });

  it("still reports the final segment, under a name that says so", async () => {
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");
    await wrapped(ctx({ event: { ts: Date.now() - 60_000 }, runId: "r" }));

    const fields = complete();
    expect(fields["finalSegmentMs"]).toBeTypeOf("number");
    expect(fields["finalSegmentMs"] as number).toBeLessThan(1_000);
    // The misleading name must not come back.
    expect(fields["durationMs"]).toBeUndefined();
  });

  it("carries both fields onto the error path too", async () => {
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => {
      throw new Error("boom");
    });
    await expect(
      wrapped(ctx({ event: { ts: Date.now() - 30_000 }, runId: "r" })),
    ).rejects.toThrow("boom");

    const err = logged.find((l) => l.msg === "fn.error")!.fields;
    expect(err["elapsedSinceTriggerMs"] as number).toBeGreaterThan(25_000);
    expect(err["finalSegmentMs"]).toBeTypeOf("number");
  });
});
