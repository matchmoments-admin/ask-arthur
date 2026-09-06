/**
 * The local drain must opt into pacing; the Inngest job must not.
 *
 * These are two halves of one rule that fail in opposite directions, so
 * asserting only one leaves the other free to break — which is what happened.
 *
 * Pacing sleeps inside whatever calls `embed()`. Six of its seven callers are
 * Inngest steps, where a sleep holds one of five concurrency slots; long
 * inline steps holding slots is the documented cause of a fleet-wide
 * run-cancellation incident here. So pacing defaults to OFF, and the Inngest
 * half is guarded in scam-engine's redditIntelEmbedWorklist test.
 *
 * This is the other half. When the default flipped to zero, the opt-in for
 * this script was dropped from the commit — the `git add` named a path that
 * did not exist on that branch and silently staged nothing — so the drain
 * shipped with no pacing. Its next run fired back-to-back requests at
 * Voyage's free tier and every batch 429'd:
 *
 *   batch 1: FAILED (100 items left for a later run) — Voyage embeddings 429
 *
 * Nothing was corrupted or overspent: the per-batch isolation held and the
 * exit code was 1. But the run did no work, and the only thing between that
 * and a silent no-op was reading the log.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const DRAIN = new URL("../scripts/_embed-backfill.ts", import.meta.url);

describe("the embedding drain paces itself", () => {
  it("opts into inter-chunk pacing", () => {
    expect(
      readFileSync(DRAIN, "utf8").includes("chunkPauseMs"),
      "scripts/_embed-backfill.ts does not pass chunkPauseMs. Pacing " +
        "defaults to off so Inngest callers cannot hold a concurrency slot, " +
        "which means this script — which holds no slot — has to ask for it. " +
        "Without it every batch 429s against the free tier's 3 requests a " +
        "minute and the run does no work.",
    ).toBe(true);
  });

  it("waits long enough to clear the free tier's per-minute allowance", () => {
    const m = readFileSync(DRAIN, "utf8").match(/chunkPauseMs:\s*([0-9_]+)/);
    expect(m, "chunkPauseMs is not a literal this can check").not.toBeNull();
    const ms = Number(m![1].replace(/_/g, ""));
    const VOYAGE_FREE_TIER_RPM = 3;
    expect(
      ms,
      `${ms}ms between requests is faster than ${VOYAGE_FREE_TIER_RPM}/minute allows`,
    ).toBeGreaterThanOrEqual((60_000 / VOYAGE_FREE_TIER_RPM) * 0.95);
  });
});
