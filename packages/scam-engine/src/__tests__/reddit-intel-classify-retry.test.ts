/**
 * #228 regression tests — classifyWithRetry helper.
 *
 * Sonnet 4.6 occasionally returns the wrong shape for `perPost` (a string
 * instead of an array) or omits `dailySummary` entirely. The classifier
 * used to abort on the first Zod failure and the whole cohort was lost.
 * `classifyWithRetry` wraps the Anthropic call with one retry that
 * injects the validation error as user-turn feedback — most failures
 * recover on the second pass.
 *
 * The helper takes the inner call function as an injected dependency
 * (its second argument) so the test mocks it directly. Schema match is
 * not asserted here — `anthropic-tool-use.test.ts` covers Zod behaviour;
 * this test pins the retry-flow contract.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { classifyWithRetry, resolveClassifyModel } from "../inngest/reddit-intel-daily";

// Minimal schema shape — just enough to satisfy the helper's generic.
const StubSchema = z.object({ ok: z.boolean() });

function buildCallArgs() {
  return {
    model: "SONNET_4_6" as const,
    system: "stub system prompt",
    user: "stub user payload",
    schema: StubSchema,
    maxTokens: 100,
  };
}

function successResponse(overrides: Partial<{
  result: z.infer<typeof StubSchema>;
  estimatedCostUsd: number;
}> = {}) {
  return {
    result: overrides.result ?? { ok: true },
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    cacheHit: false,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0.005,
    modelId: "claude-sonnet-4-6",
  };
}

describe("classifyWithRetry", () => {
  it("returns the first call result + retried=false when no error thrown", async () => {
    const callFn = vi.fn().mockResolvedValueOnce(successResponse());
    const out = await classifyWithRetry(buildCallArgs(), callFn);
    expect(out.retried).toBe(false);
    expect(out.result).toEqual({ ok: true });
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it("retries once when callFn throws schema-mismatch and returns the second response", async () => {
    const schemaErr = new Error(
      "Claude output schema mismatch (claude-sonnet-4-6): perPost: Invalid input: expected array, received string",
    );
    const callFn = vi
      .fn()
      .mockRejectedValueOnce(schemaErr)
      .mockResolvedValueOnce(successResponse({ result: { ok: true } }));

    const out = await classifyWithRetry(buildCallArgs(), callFn);

    expect(callFn).toHaveBeenCalledTimes(2);
    expect(out.retried).toBe(true);
    expect(out.retryError).toContain("Claude output schema mismatch");
    expect(out.result).toEqual({ ok: true });
  });

  it("retries once when callFn throws JSON-parse failure (the other retryable class)", async () => {
    // anthropic.ts line 276 throw — separate from schema-mismatch but
    // same retry contract: ask Sonnet to re-emit cleanly.
    const parseErr = new Error(
      "Claude JSON parse failed (claude-sonnet-4-6): Unexpected token } in JSON at position 1923",
    );
    const callFn = vi
      .fn()
      .mockRejectedValueOnce(parseErr)
      .mockResolvedValueOnce(successResponse());

    const out = await classifyWithRetry(buildCallArgs(), callFn);

    expect(callFn).toHaveBeenCalledTimes(2);
    expect(out.retried).toBe(true);
    expect(out.retryError).toContain("Claude JSON parse failed");
  });

  it("does NOT retry on non-schema errors (network timeout, 5xx, etc.)", async () => {
    const networkErr = new Error("ECONNRESET");
    const callFn = vi.fn().mockRejectedValueOnce(networkErr);

    await expect(classifyWithRetry(buildCallArgs(), callFn)).rejects.toThrow(
      "ECONNRESET",
    );
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it("propagates the second-call error if the retry also fails", async () => {
    const firstErr = new Error(
      "Claude output schema mismatch (claude-sonnet-4-6): dailySummary: expected object, received undefined",
    );
    const secondErr = new Error(
      "Claude output schema mismatch (claude-sonnet-4-6): perPost: expected array, received string",
    );
    const callFn = vi
      .fn()
      .mockRejectedValueOnce(firstErr)
      .mockRejectedValueOnce(secondErr);

    await expect(classifyWithRetry(buildCallArgs(), callFn)).rejects.toThrow(
      /perPost: expected array/,
    );
    expect(callFn).toHaveBeenCalledTimes(2);
  });

  it("injects the validation error into the retry's user payload as feedback", async () => {
    const schemaErr = new Error(
      "Claude output schema mismatch (claude-sonnet-4-6): perPost: Invalid input: expected array, received string",
    );
    const callFn = vi
      .fn()
      .mockRejectedValueOnce(schemaErr)
      .mockResolvedValueOnce(successResponse());

    await classifyWithRetry(buildCallArgs(), callFn);

    // The second call's user payload should contain both the original
    // payload AND the validation error verbatim — that's the contract.
    const secondCallArgs = callFn.mock.calls[1]?.[0];
    expect(secondCallArgs).toBeDefined();
    expect(secondCallArgs.user).toContain("stub user payload");
    expect(secondCallArgs.user).toContain("Claude output schema mismatch");
    expect(secondCallArgs.user).toContain("Re-emit a single JSON object");
    // Everything else from the original call must come through unchanged.
    expect(secondCallArgs.model).toBe("SONNET_4_6");
    expect(secondCallArgs.system).toBe("stub system prompt");
    expect(secondCallArgs.maxTokens).toBe(100);
  });
});

describe("resolveClassifyModel — Haiku cost pilot flag", () => {
  const KEY = "REDDIT_INTEL_CLASSIFY_MODEL";
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("defaults to SONNET_4_6 when the env var is unset", () => {
    delete process.env[KEY];
    expect(resolveClassifyModel()).toBe("SONNET_4_6");
  });

  it("returns HAIKU_4_5 when the env var selects it (the pilot)", () => {
    process.env[KEY] = "HAIKU_4_5";
    expect(resolveClassifyModel()).toBe("HAIKU_4_5");
  });

  it("tolerates surrounding whitespace (Vercel-stored value)", () => {
    process.env[KEY] = " HAIKU_4_5\n";
    expect(resolveClassifyModel()).toBe("HAIKU_4_5");
  });

  it("falls back to SONNET_4_6 on an unknown value (typo can't break the cron)", () => {
    process.env[KEY] = "haiku"; // not a ClaudeModelKey
    expect(resolveClassifyModel()).toBe("SONNET_4_6");
  });
});
