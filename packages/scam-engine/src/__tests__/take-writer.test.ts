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
  TELL_CAP_CHARS,
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
    const long = "x".repeat(TELL_CAP_CHARS * 2);
    const call = fakeCall([
      { feedItemId: 41994, tells: [long], where: "Reported widely." },
    ]);
    const r = await writeTakes([input()], call as never);
    expect(r.takes).toHaveLength(1);
    expect(r.takes[0].tells[0].length).toBeLessThanOrEqual(TELL_CAP_CHARS);
    expect(r.takes[0].tells[0].endsWith("…")).toBe(true);
    // Reported, not just handled. The cap ran 100 chars too tight for a month
    // because nothing counted how often it fired.
    expect(r.truncatedFieldCount).toBe(1);
  });

  it("truncates at a word boundary, not mid-word", async () => {
    // Measured on a real dry run: 6 of 10 tells were cut, several mid-word
    // ("account compromise or fun…"), which reads as a rendering fault rather
    // than an editorial choice.
    // Built from the cap so it is always over it. The literal that used to sit
    // here was 141 characters — written against a 140-char cap, and silently
    // no longer over the cap the moment that number moved.
    const sentence =
      "Callers guide the victim through a sequence of steps that typically lead to account compromise or the loss of funds held in the linked account " +
      "and any other account reachable from it, ".repeat(
        Math.ceil(TELL_CAP_CHARS / 40),
      );
    const call = fakeCall([
      { feedItemId: 41994, tells: [sentence], where: "Reported widely." },
    ]);
    const r = await writeTakes([input()], call as never);
    const tell = r.takes[0].tells[0];
    expect(tell.length).toBeLessThanOrEqual(TELL_CAP_CHARS);
    expect(tell.endsWith("…")).toBe(true);
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

  it("accepts a take with no tells rather than failing the batch", async () => {
    // Reversed from the first version, by measurement: a 25-row batch had 2
    // rows with an empty tells array, and rejecting them discarded all 25.
    // A take with no tells is still not publishable — but that is the
    // validator's decision, per row, and it has `empty_take` for it. See
    // takes.test.ts for the assertion that such a row ends up suppressed.
    const call = fakeCall([{ feedItemId: 41994, tells: [], where: "w" }]);
    const r = await writeTakes([input()], call as never);
    expect(r.takes[0].tells).toEqual([]);
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

describe("no model-written string may fail the batch on length", () => {
  // Third instance of this defect class in one feature: tells, then empty
  // tells, then auLine at 241 chars losing 24 good takes. The rule is uniform
  // now, so this test is written over the FIELDS rather than one case.
  it.each(["where", "auLine"])("truncates an over-long %s", async (field) => {
    const call = fakeCall([
      {
        feedItemId: 41994,
        tells: ["A tell"],
        where: field === "where" ? "w".repeat(600) : "short",
        auLine: field === "auLine" ? "a".repeat(600) : null,
      },
    ]);
    const r = await writeTakes([input()], call as never);
    const value =
      field === "where" ? r.takes[0].where : (r.takes[0].auLine ?? "");
    expect(value!.length).toBeLessThanOrEqual(280);
    expect(value!.endsWith("…")).toBe(true);
  });
});
