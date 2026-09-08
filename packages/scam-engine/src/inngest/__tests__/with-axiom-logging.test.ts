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
  const logged: Array<{
    msg: string;
    fields: Record<string, unknown>;
    level: string;
  }> = [];

  beforeEach(() => {
    logged.length = 0;
    process.env.FF_AXIOM_ENABLED = "true";
    vi.spyOn(axiomLogger, "getLogger").mockReturnValue({
      info: (msg: string, fields: Record<string, unknown>) =>
        logged.push({ msg, fields, level: "info" }),
      // Captured, not stubbed: fn.complete is deliberately WARN so it bypasses
      // the 10% INFO sampling (#1007). Stubbing warn here would make every
      // assertion below silently read an empty array.
      warn: (msg: string, fields: Record<string, unknown>) =>
        logged.push({ msg, fields, level: "warn" }),
      error: (msg: string, fields: Record<string, unknown>) =>
        logged.push({ msg, fields, level: "error" }),
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

describe("the elapsed metric is interpretable on a retry", () => {
  const logged: Array<{
    msg: string;
    fields: Record<string, unknown>;
    level: string;
  }> = [];

  beforeEach(() => {
    logged.length = 0;
    process.env.FF_AXIOM_ENABLED = "true";
    vi.spyOn(axiomLogger, "getLogger").mockReturnValue({
      info: (msg: string, fields: Record<string, unknown>) =>
        logged.push({ msg, fields, level: "info" }),
      // Captured, not stubbed: fn.complete is deliberately WARN so it bypasses
      // the 10% INFO sampling (#1007). Stubbing warn here would make every
      // assertion below silently read an empty array.
      warn: (msg: string, fields: Record<string, unknown>) =>
        logged.push({ msg, fields, level: "warn" }),
      error: (msg: string, fields: Record<string, unknown>) =>
        logged.push({ msg, fields, level: "error" }),
      debug: () => {},
      flush: async () => {},
    } as unknown as ReturnType<typeof axiomLogger.getLogger>);
  });

  it("carries `attempt` on fn.complete, not only on fn.start", async () => {
    // event.ts is the ORIGINAL trigger time, so on attempt 2 the elapsed value
    // includes attempt 1 plus its backoff — time that is not slot occupancy.
    // Without `attempt` on the completion record there is no way to exclude
    // those rows, and the metric is unusable for the thing it was added for.
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");
    await wrapped(
      ctx({ event: { ts: Date.now() - 5_000 }, runId: "r", attempt: 2 }),
    );

    const fields = logged.find((l) => l.msg === "fn.complete")!.fields;
    expect(fields["attempt"]).toBe(2);
  });

  it("emits fn.complete at WARN so it is never sampled away", async () => {
    // The point of #1007. fn.complete fires exactly once per logical run, which
    // makes it the only true run counter this wrapper emits — at INFO's 10%
    // sampling a low-frequency cron was indistinguishable from one that never
    // ran (archive-shadows-retention: 1 start, 0 completes across ~19 nightly
    // runs). Demoting it back to info would silently restore that blindness,
    // and would also invalidate docs/ops/inngest-slot-budget.md, which now
    // states the percentiles cover every run.
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");
    await wrapped(ctx({ event: { ts: Date.now() - 1_000 }, runId: "r" }));

    const complete = logged.find((l) => l.msg === "fn.complete")!;
    expect(complete.level).toBe("warn");

    // fn.start deliberately stays INFO: it fires more than once per run (the
    // handler is re-executed at every step boundary), so un-sampling it would
    // add volume without producing a run counter.
    expect(logged.find((l) => l.msg === "fn.start")!.level).toBe("info");
  });

  it("carries `attempt` on fn.error too", async () => {
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => {
      throw new Error("boom");
    });
    await expect(
      wrapped(
        ctx({ event: { ts: Date.now() - 5_000 }, runId: "r", attempt: 1 }),
      ),
    ).rejects.toThrow("boom");

    expect(logged.find((l) => l.msg === "fn.error")!.fields["attempt"]).toBe(1);
  });
});

/**
 * The Axiom flush must complete before the handler returns.
 *
 * It used to be `void log.flush()` — fire-and-forget, on the assumption that
 * the function instance outlives the flush. Measured 2026-09-08 it does not:
 * 44 preclassify events, 41 fn.complete rows in Axiom, ~7% lost on an
 * always-ship WARN signal. For a once-a-day function that loss made
 * clone-watch-enrich-attribution look dead for a month while Inngest showed
 * every daily run Completed. Silence in Axiom is not evidence a function did
 * not run.
 */
describe("the Axiom flush is awaited, bounded, and never fatal", () => {
  const install = (flush: () => Promise<void>) => {
    process.env.FF_AXIOM_ENABLED = "true";
    vi.spyOn(axiomLogger, "getLogger").mockReturnValue({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      flush,
    } as unknown as ReturnType<typeof axiomLogger.getLogger>);
  };

  it("does not return until the flush has resolved", async () => {
    let flushed = false;
    install(async () => {
      await new Promise((r) => setTimeout(r, 30));
      flushed = true;
    });
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");

    await wrapped(ctx({ runId: "r", attempt: 0 }));

    // With `void log.flush()` this is false: the handler has returned and the
    // instance may already be frozen with the POST still in flight.
    expect(flushed).toBe(true);
  });

  it("also waits on the error path before rethrowing", async () => {
    let flushed = false;
    install(async () => {
      await new Promise((r) => setTimeout(r, 30));
      flushed = true;
    });
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => {
      throw new Error("boom");
    });

    await expect(wrapped(ctx({ runId: "r" }))).rejects.toThrow("boom");
    expect(flushed).toBe(true);
  });

  it("never lets a failing flush fail the function", async () => {
    install(async () => {
      throw new Error("axiom down");
    });
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");

    await expect(wrapped(ctx({ runId: "r" }))).resolves.toBe("ok");
  });

  it("does not hang on a flush that never resolves", async () => {
    // next-axiom's flush has no timeout of its own. Awaiting it unbounded
    // would let a slow Axiom stall every function's final replay.
    install(() => new Promise<void>(() => {}));
    const wrapped = withAxiomLogging({ fnId: "test-fn" }, async () => "ok");

    const started = Date.now();
    await expect(wrapped(ctx({ runId: "r" }))).resolves.toBe("ok");
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);
});
