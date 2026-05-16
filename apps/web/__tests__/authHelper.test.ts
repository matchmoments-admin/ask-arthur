/**
 * PR-AUTH-HARDEN regression — direct unit coverage for the
 * `getSupabaseUserOrThrow` helper itself.
 *
 * The companion `authHardening.test.ts` mocks the helper to throw and
 * verifies the FIVE protected routes wrap that error into 503 +
 * Retry-After. This file flips the lens: it imports the REAL helper and
 * verifies the Promise.race timing contract — the actual property that
 * keeps a degraded Supabase Auth from cascading into a Vercel
 * MIDDLEWARE_INVOCATION_TIMEOUT 504 the way it did during incident
 * 2026-05-09. Without this, no automated check exercises the helper's
 * own timer logic; future edits could silently break the race.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AuthUnavailableError,
  getSupabaseUserOrThrow,
} from "@/lib/auth";

afterEach(() => {
  vi.useRealTimers();
});

describe("getSupabaseUserOrThrow — Promise.race contract", () => {
  it("returns the Supabase user when getUser resolves under the timeout budget", async () => {
    const fakeUser = {
      id: "u_1",
      email: "a@b.c",
      app_metadata: {},
      user_metadata: {},
    };
    const authClient = {
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: fakeUser }, error: null }),
      },
    };

    const result = await getSupabaseUserOrThrow(authClient as never);
    expect(result).toEqual(fakeUser);
  });

  it("throws AuthUnavailableError when getUser hangs past AUTH_TIMEOUT_MS (5s)", async () => {
    vi.useFakeTimers();
    const authClient = {
      auth: {
        // Promise that never resolves — simulates Supabase Auth degradation.
        getUser: vi.fn(() => new Promise(() => {})),
      },
    };

    // Attach a `.catch` immediately to swallow the rejection — fake timers
    // can flush microtasks before vitest's `expect(...).rejects` matcher
    // would attach its own handler, producing a spurious unhandled-rejection
    // warning even when the assertion would have passed.
    const pending = getSupabaseUserOrThrow(authClient as never).catch(
      (e: unknown) => e,
    );
    // Race-loser path: advance just past the 5s budget so the helper's
    // internal setTimeout wins the Promise.race.
    await vi.advanceTimersByTimeAsync(5001);
    const err = await pending;
    expect(err).toBeInstanceOf(AuthUnavailableError);
  });
});
