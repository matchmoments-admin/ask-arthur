/**
 * The take writer had no tests when the architecture review reached it, and
 * the injection seam to add them was already there (`writeTakes(items, callFn)`).
 * These cover the two behaviours with real production risk — a model returning
 * an id that was not in the batch, and the schema's reject-vs-truncate policy —
 * plus the excerpt cap, which is what stands between this call and a token bill
 * proportional to `body_md`.
 */
import { describe, expect, it, vi } from "vitest";

import {
  TAKE_EXCERPT_CHARS,
  TAKE_MAX_TOKENS,
  TAKE_TIMEOUT_MS,
  buildTakeUserPayload,
  writeTakes,
  type TakeWriterInput,
} from "../reddit-intel/take-writer";

function input(over: Partial<TakeWriterInput> = {}): TakeWriterInput {
  return {
    feedItemId: 41994,
    intentLabel: "advance_fee",
    confidence: 0.88,
    modusOperandi: "A fee is requested before a service is delivered.",
    narrativeSummary: "Someone was asked to pay before a shoot.",
    tacticTags: ["fake_legitimacy"],
    brandsImpersonated: [],
    countryHints: [],
    isEmerging: false,
    excerpt: "A brand offered a collaboration and asked for a shipping fee.",
    ...over,
  };
}

/** A stand-in for callClaudeJson shaped like its real return. */
function fakeCall(takes: unknown[]) {
  return vi.fn(async (args: { schema: { parse: (v: unknown) => unknown } }) => ({
    result: args.schema.parse({ takes }),
    modelId: "claude-haiku-4-5-20251001",
    estimatedCostUsd: 0.0004,
    usage: {
      inputTokens: 900,
      outputTokens: 300,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    cacheHit: false,
    stopReason: "end_turn",
    truncated: false,
  }));
}

describe("writeTakes", () => {
  it("drops a take whose id was not in the batch", () => {
    // The failure this prevents is the worst one available to this feature:
    // a take written about one post attached to a different post's row, which
    // then renders publicly beside the wrong Reddit permalink.
    const call = fakeCall([
      { feedItemId: 41994, tells: ["Payment is requested first"], where: "w" },
      { feedItemId: 99999, tells: ["Invented"], where: "w" },
    ]);
    return writeTakes([input()], call as never).then((r) => {
      expect(r.takes).toHaveLength(1);
      expect(r.takes[0].feedItemId).toBe(41994);
    });
  });

  it("truncates an over-long tell instead of failing the batch", async () => {
    // 39 good takes and the money spent generating them must not be thrown
    // away because one string ran long. Mirrors the classifier's quote policy.
    const long = "x".repeat(400);
    const call = fakeCall([
      { feedItemId: 41994, tells: [long], where: "Reported widely." },
    ]);
    const r = await writeTakes([input()], call as never);
    expect(r.takes).toHaveLength(1);
    expect(r.takes[0].tells[0].length).toBeLessThanOrEqual(140);
    expect(r.takes[0].tells[0].endsWith("…")).toBe(true);
  });

  it("truncates at a word boundary, not mid-word", async () => {
    // Measured on a real dry run: 6 of 10 tells were cut, several mid-word
    // ("account compromise or fun…"), which reads as a rendering fault rather
    // than an editorial choice.
    const sentence =
      "Callers guide the victim through a sequence of steps that typically lead to account compromise or the loss of funds held in the linked account";
    const call = fakeCall([
      { feedItemId: 41994, tells: [sentence], where: "Reported widely." },
    ]);
    const r = await writeTakes([input()], call as never);
    const tell = r.takes[0].tells[0];
    expect(tell.length).toBeLessThanOrEqual(140);
    // The character before the ellipsis must end a word.
    expect(tell.replace(/…$/, "")).toMatch(/\w$/);
    expect(sentence.startsWith(tell.replace(/…$/, ""))).toBe(true);
  });

  it("keeps at most three tells", async () => {
    const call = fakeCall([
      { feedItemId: 41994, tells: ["a", "b", "c", "d", "e"], where: "w" },
    ]);
    const r = await writeTakes([input()], call as never);
    expect(r.takes[0].tells).toHaveLength(3);
  });

  it("accepts a null where rather than losing the batch over one field", async () => {
    const call = fakeCall([
      { feedItemId: 41994, tells: ["Payment first"], where: null },
    ]);
    const r = await writeTakes([input()], call as never);
    expect(r.takes[0].where ?? null).toBeNull();
  });

  it("still fails loudly when a take has no tells at all", async () => {
    // The one thing that must NOT be tolerated: tells is the take. An empty
    // array here would render a heading with nothing under it.
    const call = fakeCall([{ feedItemId: 41994, tells: [], where: "w" }]);
    await expect(writeTakes([input()], call as never)).rejects.toThrow();
  });

  it("caps the excerpt so input tokens cannot track body_md", async () => {
    // body_md holds up to 20,000 characters since v299. Without this cap a
    // 40-item batch would send 800,000 characters and the cost would follow.
    const payload = buildTakeUserPayload([
      input({ excerpt: "y".repeat(5_000) }),
    ]);
    const parsed = JSON.parse(payload) as {
      items: { excerpt: string }[];
    };
    expect(parsed.items[0].excerpt.length).toBe(TAKE_EXCERPT_CHARS);
  });

  it("sends the structured analysis, not the raw post", async () => {
    // The whole argument for a second stage is that stage 1 already did the
    // reading. If this payload ever grows the full body, the two stages have
    // collapsed into one expensive one.
    const parsed = JSON.parse(buildTakeUserPayload([input()])) as {
      items: Record<string, unknown>[];
    };
    expect(Object.keys(parsed.items[0])).toEqual(
      expect.arrayContaining(["scamType", "howItWorks", "tactics"]),
    );
    expect(parsed.items[0]).not.toHaveProperty("body_md");
  });

  it("keeps the timeout able to cover a full-length response", () => {
    // Same invariant the classifier has: raising maxTokens without raising
    // timeoutMs converts a truncation into a timeout, which returns nothing.
    const SLOWEST_TOKENS_PER_SEC = 50;
    expect(TAKE_TIMEOUT_MS).toBeGreaterThanOrEqual(
      (TAKE_MAX_TOKENS / SLOWEST_TOKENS_PER_SEC) * 1000,
    );
  });
});
