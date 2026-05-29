import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withAxiomLogging } from "../with-axiom-logging";

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
  event?: { data?: Record<string, unknown> };
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
