import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  embed,
  EMBED_REQUEST_TIMEOUT_MS_DEFAULT,
  embedRequestTimeoutMs,
  __testing,
} from "../embeddings";
import { MAX_IN_STEP_WALL_CLOCK_MS } from "../inngest/step-budget";

/**
 * An embedding call must not be able to hang forever.
 *
 * WHAT THIS COSTS WHEN IT IS MISSING. Until #1134 neither provider fetch in
 * embeddings.ts carried an `AbortSignal` — there was no timeout anywhere in
 * the file. Every embedding call runs inside an Inngest `step.run`, and a step
 * holds one of the account's five concurrency slots for its whole duration
 * (ADR-0019, measured at 5/5 in use on 2026-09-07). A hung socket therefore
 * held a fleet slot indefinitely, and the three embed functions
 * (reddit-intel-embed, scam-reports-backfill-embed, acnc-charity-backfill-embed)
 * had no bound of their own either.
 *
 * Go-red, verified: delete `signal: AbortSignal.timeout(...)` from embedFetch
 * and "passes an AbortSignal" fails immediately, while "translates an abort"
 * fails by hanging until vitest's own timeout — which is precisely the
 * production symptom, reproduced.
 */

/** A fetch that never resolves on its own but honours an abort, like the real one. */
function hangingFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // no signal → hangs forever, as it used to
        signal.addEventListener("abort", () =>
          reject(
            signal.reason ??
              Object.assign(new Error("aborted"), { name: "AbortError" }),
          ),
        );
      }),
  );
}

describe("embedding requests are bounded", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-key";
    process.env.EMBEDDING_PROVIDER = "voyage";
    delete process.env.EMBEDDING_MODEL_GENERIC;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.unstubAllEnvs();
  });

  it("translates an abort into a named, attributable error", async () => {
    // 50ms so the test is fast; the production default is 30s.
    vi.stubEnv("EMBED_REQUEST_TIMEOUT_MS", "50");
    fetchSpy = hangingFetch();

    await expect(embed(["hello"])).rejects.toThrow(
      /voyage embeddings timed out after 50ms/i,
    );
  });

  it("passes an AbortSignal to the provider fetch", async () => {
    vi.stubEnv("EMBED_REQUEST_TIMEOUT_MS", "50");
    fetchSpy = hangingFetch();

    await expect(embed(["hello"])).rejects.toThrow();

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(
      init?.signal,
      "embedFetch dropped its AbortSignal — a provider hang would hold an " +
        "Inngest concurrency slot indefinitely.",
    ).toBeInstanceOf(AbortSignal);
  });
});

describe("embedRequestTimeoutMs — a bad override cannot disable the bound", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the default when unset", () => {
    vi.stubEnv("EMBED_REQUEST_TIMEOUT_MS", "");
    expect(embedRequestTimeoutMs()).toBe(EMBED_REQUEST_TIMEOUT_MS_DEFAULT);
  });

  it("accepts a valid override", () => {
    vi.stubEnv("EMBED_REQUEST_TIMEOUT_MS", "5000");
    expect(embedRequestTimeoutMs()).toBe(5000);
  });

  it.each([
    ["not a number", "30s"],
    ["zero", "0"],
    ["negative", "-1"],
  ])(
    "falls back to the default rather than disabling on %s",
    (_label, value) => {
      // The `parseFloat("$10")` lesson from CLAUDE.md: a silently-NaN cost
      // brake is worse than no brake. Zero would abort every call instantly;
      // NaN would mean AbortSignal.timeout(NaN) — neither is a bound.
      vi.stubEnv("EMBED_REQUEST_TIMEOUT_MS", value);
      expect(embedRequestTimeoutMs()).toBe(EMBED_REQUEST_TIMEOUT_MS_DEFAULT);
    },
  );
});

describe("the per-request timeout composes inside a single step", () => {
  /**
   * A per-socket bound is not a per-step bound. Chunks run SEQUENTIALLY, so a
   * caller's worst case inside one `step.run` is ceil(texts / chunk) x the
   * timeout — and the two backfill embedders bound themselves with SPANNING
   * budgets, which are checked between steps and cap nothing inside one.
   *
   * At the original 30s the largest batch in the repo (acnc, 200 texts = 10
   * chunks) came to 300s against a 300s maxDuration: the exact
   * "HTTP 504, no step output produced" this timeout was added to prevent,
   * reachable by a slow-but-not-hung provider (caught in review, #1138).
   *
   * Go-red: restore EMBED_REQUEST_TIMEOUT_MS_DEFAULT = 30_000.
   */
  // acnc-charity-backfill-embed's BATCH_SIZE, the largest single embed() call
  // made anywhere in the repo.
  const LARGEST_BATCH_TEXTS = 200;

  it("keeps the largest batch's worst case inside the in-step ceiling", () => {
    const chunks = Math.ceil(LARGEST_BATCH_TEXTS / __testing.EMBED_CHUNK_TEXTS);
    const worstCaseMs = chunks * EMBED_REQUEST_TIMEOUT_MS_DEFAULT;
    expect(
      worstCaseMs,
      `${LARGEST_BATCH_TEXTS} texts is ${chunks} sequential chunks, so the ` +
        `worst case inside one step is ${worstCaseMs}ms against an in-step ` +
        `ceiling of ${MAX_IN_STEP_WALL_CLOCK_MS}ms. Lower the timeout, lower ` +
        `the batch size, or give that step its own budget.`,
    ).toBeLessThanOrEqual(MAX_IN_STEP_WALL_CLOCK_MS);
  });
});
