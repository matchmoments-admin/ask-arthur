/**
 * The take module is the only place the write path's decisions live, so this
 * is where they get tested — with no database, no Inngest and no Claude, the
 * same shape as `rollupBrandRegister`'s test.
 *
 * The assertions that matter are the ones about what reaches the row: a
 * suppressed take must not carry its text, and a row the model skipped must
 * come back as a row rather than vanish.
 */
import { describe, expect, it, vi } from "vitest";

import {
  generateTakesForPosts,
  needsTake,
  type IntelRowForTake,
} from "../reddit-intel/takes";

function row(over: Partial<IntelRowForTake> = {}): IntelRowForTake {
  return {
    intelId: "11111111-1111-1111-1111-111111111111",
    feedItemId: 41994,
    intentLabel: "advance_fee",
    confidence: 0.88,
    modusOperandi: "A fee is requested before a service is delivered.",
    narrativeSummary: "Someone was asked to pay before a shoot.",
    tacticTags: ["fake_legitimacy"],
    brandsImpersonated: [],
    countryHints: [],
    isEmerging: false,
    isScamReport: null,
    sourceText: "x".repeat(500),
    ...over,
  };
}

/** Stands in for callClaudeJson, shaped like its real return. */
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

const CLEAN = {
  feedItemId: 41994,
  tells: ["Payment is requested before any service is delivered"],
  where: "Reported across freelance and marketplace platforms.",
  auLine: null,
};

describe("generateTakesForPosts", () => {
  it("returns a ready take for a clean generation", async () => {
    const r = await generateTakesForPosts([row()], fakeCall([CLEAN]) as never);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].takeStatus).toBe("ready");
    expect(r.results[0].takeTells).toEqual(CLEAN.tells);
    expect(r.readyCount).toBe(1);
  });

  it("suppresses a take that leaks an amount, and stores none of its text", async () => {
    // The whole point of the validator sitting on the WRITE path. If the text
    // were stored against a hidden status, a later change to how the page
    // gates would publish content already judged unpublishable.
    const leaky = { ...CLEAN, tells: ["Victims are asked to pay $95 up front"] };
    const r = await generateTakesForPosts([row()], fakeCall([leaky]) as never);
    expect(r.results[0].takeStatus).toBe("suppressed");
    expect(r.results[0].takeSuppressedReason).toBe("contains_amount");
    expect(r.results[0].takeTells).toEqual([]);
    expect(r.results[0].takeWhere).toBeNull();
    expect(r.suppressedCount).toBe(1);
  });

  it("returns a failed row rather than dropping a post the model skipped", async () => {
    // An absent row looks identical to one never attempted, and nothing would
    // ever find it again.
    const rows = [row({ feedItemId: 1 }), row({ feedItemId: 2 })];
    const call = fakeCall([{ ...CLEAN, feedItemId: 1 }]);
    const r = await generateTakesForPosts(rows, call as never);
    expect(r.results).toHaveLength(2);
    expect(r.results[1].takeStatus).toBe("failed");
    expect(r.results[1].takeSuppressedReason).toBe("generation_missing");
  });

  it("preserves input order so results can be zipped back to rows", async () => {
    const rows = [row({ feedItemId: 7 }), row({ feedItemId: 3 })];
    const call = fakeCall([
      { ...CLEAN, feedItemId: 3 },
      { ...CLEAN, feedItemId: 7 },
    ]);
    const r = await generateTakesForPosts(rows, call as never);
    expect(r.results.map((x) => x.feedItemId)).toEqual([7, 3]);
  });

  it("stamps its own prompt version, not the classifier's", async () => {
    // Take text is regenerated independently of classification; sharing a
    // version would make "which takes need rewriting" unanswerable.
    const r = await generateTakesForPosts([row()], fakeCall([CLEAN]) as never);
    expect(r.results[0].takePromptVersion).toMatch(/^arthurs-take-/);
    expect(r.results[0].takeModelVersion).toContain("haiku");
  });

  it("suppresses when the source is too thin to hold a pattern", async () => {
    const r = await generateTakesForPosts(
      [row({ sourceText: "too short" })],
      fakeCall([CLEAN]) as never,
    );
    expect(r.results[0].takeStatus).toBe("suppressed");
    expect(r.results[0].takeSuppressedReason).toBe("source_too_short");
  });

  it("measures source length against what the writer was shown, not the row", async () => {
    // A 20,000-char body is capped to the excerpt budget before the model sees
    // it, so the thin-source rule must judge the budgeted length. Judging the
    // raw row would pass posts the model effectively never read.
    const r = await generateTakesForPosts(
      [row({ sourceText: "y".repeat(20_000) })],
      fakeCall([CLEAN]) as never,
    );
    expect(r.results[0].takeStatus).toBe("ready");
  });

  it("makes no model call for an empty batch", async () => {
    const call = fakeCall([]);
    const r = await generateTakesForPosts([], call as never);
    expect(call).not.toHaveBeenCalled();
    expect(r.results).toEqual([]);
    expect(r.estimatedCostUsd).toBe(0);
  });

  it("passes cost telemetry back for the caller to log", async () => {
    // The module does no IO; the step owns the sink. But it must hand over
    // everything a cost_telemetry row needs, or the caller invents numbers.
    const r = await generateTakesForPosts([row()], fakeCall([CLEAN]) as never);
    expect(r.estimatedCostUsd).toBeGreaterThan(0);
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(r.modelId).toBeTruthy();
  });
});

describe("needsTake — the spend guard", () => {
  it("skips rows that already carry a decision", () => {
    // Without this a retry, a re-fired event or a re-run backfill pays Claude
    // again for content that already exists.
    expect(needsTake({ takeStatus: "ready" })).toBe(false);
    expect(needsTake({ takeStatus: "suppressed" })).toBe(false);
  });

  it("retries a failure and an untouched row", () => {
    expect(needsTake({ takeStatus: "failed" })).toBe(true);
    expect(needsTake({ takeStatus: "none" })).toBe(true);
    expect(needsTake({})).toBe(true);
  });
});

describe("empty tells are suppressed, not fatal", () => {
  it("suppresses a take the model returned with no tells", async () => {
    // The batch-level counterpart to take-writer's "accepts no tells": the
    // row survives to the validator, which refuses it individually, and the
    // other 24 takes in the batch are unaffected.
    const call = fakeCall([{ feedItemId: 41994, tells: [], where: null }]);
    const r = await generateTakesForPosts([row()], call as never);
    expect(r.results[0].takeStatus).toBe("suppressed");
    expect(r.results[0].takeSuppressedReason).toBe("empty_take");
  });

  it("keeps good takes in a batch that also contains an empty one", async () => {
    const rows = [row({ feedItemId: 1 }), row({ feedItemId: 2 })];
    const call = fakeCall([
      { feedItemId: 1, tells: [], where: null },
      {
        feedItemId: 2,
        tells: ["Payment is requested before any service is delivered"],
        where: "Reported widely.",
      },
    ]);
    const r = await generateTakesForPosts(rows, call as never);
    expect(r.results[0].takeStatus).toBe("suppressed");
    expect(r.results[1].takeStatus).toBe("ready");
    expect(r.readyCount).toBe(1);
  });
});
