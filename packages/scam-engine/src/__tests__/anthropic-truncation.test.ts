/**
 * Truncation detection in callClaudeJson (#996 Part A).
 *
 * The failure this guards against is silent by construction: when generation
 * stops at max_tokens and the fields lost happen to be `.optional()`, Zod
 * accepts the truncated payload and the caller cannot tell. Production had 24
 * of 79 reddit-intel classify runs in that state, each losing its daily
 * summary while writing 40 of 40 per-post rows.
 *
 * Part A only makes it observable. `throwOnTruncation` exists but no
 * production call site sets it, so the throw path here is tested ahead of its
 * first real caller — deliberately, because Part B's cost accounting depends
 * on the error carrying `usage` and `estimatedCostUsd`, and nothing else
 * asserts that.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import {
  callClaudeJson,
  ClaudeTruncatedOutputError,
} from "../anthropic";

const StubSchema = z.object({
  head: z.string(),
  tail: z.string().optional(),
});

function apiResponse(
  overrides: {
    stopReason?: string | null;
    text?: string;
    outputTokens?: number;
  } = {},
) {
  return {
    content: [
      {
        type: "text",
        text: overrides.text ?? JSON.stringify({ head: "a", tail: "b" }),
      },
    ],
    stop_reason: overrides.stopReason ?? "end_turn",
    usage: {
      input_tokens: 100,
      output_tokens: overrides.outputTokens ?? 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

function args(overrides: Record<string, unknown> = {}) {
  return {
    model: "HAIKU_4_5" as const,
    system: "stub system prompt",
    user: "stub user payload",
    schema: StubSchema,
    maxTokens: 500,
    ...overrides,
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("callClaudeJson truncation detection", () => {
  it("reports stopReason and truncated=false on a normal completion", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse({ stopReason: "end_turn" }));

    const out = await callClaudeJson(args());

    expect(out.stopReason).toBe("end_turn");
    expect(out.truncated).toBe(false);
    expect(out.result).toEqual({ head: "a", tail: "b" });
  });

  it("treats tool_use as a normal completion — what 6 of 7 callers actually see", async () => {
    // Verified against the live API: in tool-use mode a successful response
    // carries stop_reason "tool_use", NOT "end_turn". Since almost every
    // production caller sets useToolUse, "tool_use" is the normal case in
    // this codebase, and a truncation check written as `!== "end_turn"`
    // would flag every healthy tool-use call. `=== "max_tokens"` is the only
    // formulation that survives both paths.
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { head: "a", tail: "b" } }],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 100,
        output_tokens: 34,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });

    const out = await callClaudeJson(
      args({ useToolUse: true, toolName: "submit_stub" }),
    );

    expect(out.stopReason).toBe("tool_use");
    expect(out.truncated).toBe(false);
    expect(out.result).toEqual({ head: "a", tail: "b" });
  });

  it("reports truncated=true when generation stopped at max_tokens", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse({ stopReason: "max_tokens" }));

    const out = await callClaudeJson(args());

    expect(out.stopReason).toBe("max_tokens");
    expect(out.truncated).toBe(true);
  });

  it("still RETURNS the partial result by default — the caller decides", async () => {
    // The whole point of Part A: a truncated response that parses cleanly is
    // handed back, because callers persist that work today. Flipping this to
    // a throw without opting in would be the data-loss regression.
    mockCreate.mockResolvedValueOnce(
      apiResponse({
        stopReason: "max_tokens",
        text: JSON.stringify({ head: "a" }), // `tail` lost to truncation
      }),
    );

    const out = await callClaudeJson(args());

    expect(out.truncated).toBe(true);
    expect(out.result).toEqual({ head: "a" });
  });

  it("throws with usage and cost attached when throwOnTruncation is set", async () => {
    mockCreate.mockResolvedValueOnce(
      apiResponse({ stopReason: "max_tokens", outputTokens: 500 }),
    );

    const err = await callClaudeJson(
      args({ throwOnTruncation: true }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClaudeTruncatedOutputError);
    const typed = err as ClaudeTruncatedOutputError;

    // Part B attributes the wasted spend from these fields. Without them the
    // caller cannot cost a truncated call, because the wrapper threw before
    // returning usage — the exact gap reddit-intel-daily documents today.
    expect(typed.usage.outputTokens).toBe(500);
    expect(typed.estimatedCostUsd).toBeGreaterThan(0);
    expect(typed.maxTokens).toBe(500);
    expect(typed.partial).toEqual({ head: "a", tail: "b" });
  });

  it("is not misclassified as a transient error by the inbound-scan retry gate", async () => {
    // Copied verbatim from apps/web/app/api/inbound-scan/route.ts. It retries
    // on any bare 5xx-shaped number, so a diagnostic like `output_tokens=503`
    // in the message would make a deterministic truncation look like a server
    // blip and burn the retry budget re-sending the same over-budget prompt.
    // Asserting against the real regex rather than a /\d{3}/ proxy — the model
    // ID legitimately contains digit runs, and only word-bounded ones matter.
    const INBOUND_SCAN_TRANSIENT =
      /\b(408|429|5\d\d)\b|overloaded|rate.?limit|timeout|ECONNRESET|ETIMEDOUT|fetch failed|network/i;

    // 503 is the adversarial case: the token count most likely to be read as
    // a 5xx if it ever leaked into the message.
    mockCreate.mockResolvedValueOnce(
      apiResponse({ stopReason: "max_tokens", outputTokens: 503 }),
    );

    const err = (await callClaudeJson(
      args({ throwOnTruncation: true }),
    ).catch((e: unknown) => e)) as Error;

    expect(err.message).toBe(
      "Claude output truncated (claude-haiku-4-5-20251001)",
    );
    expect(INBOUND_SCAN_TRANSIENT.test(err.message)).toBe(false);
    // The count is still available — as a typed field, where no classifier
    // pattern-matches it.
    expect((err as ClaudeTruncatedOutputError).usage.outputTokens).toBe(503);
    // Explicit, because an Error subclass that omits it still reports "Error",
    // and analyze/route.ts logs err.name as Axiom's `errorType`.
    expect(err.name).toBe("ClaudeTruncatedOutputError");
  });
});

describe("transport failures", () => {
  it("rethrows the original error unchanged", async () => {
    // The telemetry row is observation, not handling. A caller's retry logic
    // keys on the real SDK error, so replacing or wrapping it would change
    // behaviour — and if the telemetry insert itself throws, the caller must
    // still see the Anthropic error rather than a Supabase one.
    const rateLimit = Object.assign(new Error("429 rate_limit_error"), {
      status: 429,
    });
    mockCreate.mockRejectedValueOnce(rateLimit);

    const err = await callClaudeJson(args()).catch((e: unknown) => e);

    expect(err).toBe(rateLimit);
    expect((err as { status?: number }).status).toBe(429);
  });

  it("does not swallow the failure when telemetry is unavailable", async () => {
    // No Supabase env in tests, so logCost's createServiceClient() returns
    // null or throws — either way the original error must still surface.
    mockCreate.mockRejectedValueOnce(new Error("ETIMEDOUT"));

    await expect(callClaudeJson(args())).rejects.toThrow("ETIMEDOUT");
  });
});

describe("truncation that BREAKS the schema", () => {
  it("still throws the schema-mismatch error, but logs truncation as the cause", async () => {
    // The misdiagnosis path this whole issue is about. Generation stops
    // mid-object, the trailing REQUIRED field is absent, and Zod reports a
    // missing field — which reads as prompt non-compliance rather than
    // running out of room. The message must not change (two classifiers
    // match it), so the root cause has to ride in the log metadata.
    const errorSpy = vi
      .spyOn(await import("@askarthur/utils/logger").then((m) => m.logger), "error")
      .mockImplementation(() => {});

    mockCreate.mockResolvedValueOnce(
      apiResponse({
        stopReason: "max_tokens",
        text: JSON.stringify({ tail: "b" }), // required `head` lost
        outputTokens: 500,
      }),
    );

    const err = (await callClaudeJson(args()).catch(
      (e: unknown) => e,
    )) as Error;

    // Unchanged surface — retry-with-feedback still recognises it.
    expect(err.message.startsWith("Claude output schema mismatch")).toBe(true);

    // ...but the log now says WHY, which it previously could not.
    const logged = errorSpy.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(logged.truncated).toBe(true);
    expect(logged.stopReason).toBe("max_tokens");
    expect(logged.outputTokens).toBe(500);

    errorSpy.mockRestore();
  });
});

describe("existing error prefixes are byte-stable", () => {
  // isSchemaRetryableError in reddit-intel-daily.ts matches these by
  // startsWith. A change here silently disables retry-with-feedback.
  it("keeps the schema-mismatch prefix", async () => {
    mockCreate.mockResolvedValueOnce(
      apiResponse({ text: JSON.stringify({ wrong: "shape" }) }),
    );

    const err = (await callClaudeJson(args()).catch(
      (e: unknown) => e,
    )) as Error;

    expect(err.message.startsWith("Claude output schema mismatch")).toBe(true);
  });

  it("keeps the JSON-parse prefix", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse({ text: "not json at all" }));

    const err = (await callClaudeJson(args()).catch(
      (e: unknown) => e,
    )) as Error;

    expect(err.message.startsWith("Claude JSON parse failed")).toBe(true);
  });
});
