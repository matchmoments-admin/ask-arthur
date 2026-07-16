/**
 * Regression test for the middleware auth-timeout timer leak.
 *
 * Bug (fixed): `withTimeout` armed a setTimeout inside Promise.race but never
 * cleared it. Promise.race resolves with the winner without cancelling the
 * loser, so the timer always fired at t+ms — logging a fictional
 * "timed out after 3000ms" even when the wrapped promise resolved in ~40ms —
 * and, on Fluid Compute (persistent instance), leaked one live timer per
 * request. It produced ~5,300 bogus middleware errors/7d, 1:1 with request
 * volume (incl. anonymous traffic that never hits the network).
 *
 * These tests lock in: (1) when the promise wins, no error is logged and the
 * value passes through; (2) when the timeout genuinely wins, exactly one error
 * is logged and null is returned; (3) no orphan timer survives either path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const errorSpy = vi.fn();
vi.mock("@askarthur/utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => errorSpy(...args),
  },
}));

// The other middleware top-level imports pull in Next/server internals; stub
// the ones with side effects so importing withTimeout is cheap.
vi.mock("@askarthur/supabase/middleware", () => ({
  createMiddlewareClient: vi.fn(),
}));
vi.mock("@askarthur/utils/axiom-logger", () => ({ getLogger: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({
  verifyAdminToken: vi.fn(() => false),
  COOKIE_NAME: "aa_admin",
}));

import { withTimeout } from "../middleware";

describe("withTimeout", () => {
  beforeEach(() => {
    errorSpy.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT log a timeout when the promise resolves first, and clears the timer", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 3000, "auth");
    expect(result).toBe("ok");
    // Advance well past the budget: a leaked timer would fire here and log.
    vi.advanceTimersByTime(10_000);
    expect(errorSpy).not.toHaveBeenCalled();
    // No orphan timer should remain scheduled.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs exactly once and returns null when the timeout genuinely wins", async () => {
    const neverResolves = new Promise<string>(() => {});
    const promise = withTimeout(neverResolves, 3000, "auth");
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("auth timed out after 3000ms");
    expect(vi.getTimerCount()).toBe(0);
  });
});
