/**
 * The output-budget invariant for the daily classifier (#996 / A1).
 *
 * Why a test rather than a smoke run: whether any single classify call
 * truncates is probabilistic. Post count is 40 whether or not a run caps out
 * (measured: identical means on both sides), so the driver is per-post
 * verbosity varying run to run, and ~69% of runs already fit under the old
 * 12,000 ceiling. One live call at the new ceiling would almost certainly
 * come back clean regardless of whether the change helped — it cannot
 * distinguish. The `reddit-intel-truncated` marker rate over weeks is the
 * real instrument.
 *
 * What IS deterministic, and what breaks silently, is the relationship
 * between the two constants. That is what this pins.
 */
import { describe, expect, it } from "vitest";

import {
  CLASSIFY_MAX_TOKENS,
  CLASSIFY_TIMEOUT_MS,
} from "../inngest/reddit-intel-daily";

// Sonnet 4.6's slowest observed sustained output rate. The timeout has to
// cover a full-length response at this rate or the ceiling is unreachable.
const SLOWEST_TOKENS_PER_SEC = 50;

describe("classify output budget", () => {
  it("gives the timeout enough room for a full-length response", () => {
    // The failure this prevents: raising maxTokens without raising timeoutMs
    // converts a truncation into a timeout. That is strictly worse — a
    // truncated response still yields 40 of 40 per-post rows, a timeout
    // yields nothing and burns the Inngest attempt.
    const worstCaseMs = (CLASSIFY_MAX_TOKENS / SLOWEST_TOKENS_PER_SEC) * 1000;
    expect(CLASSIFY_TIMEOUT_MS).toBeGreaterThanOrEqual(worstCaseMs);
  });

  it("stays inside Inngest's 15-minute function ceiling with retry headroom", () => {
    // The wrapper can retry once (classifyWithRetry), so two full-length
    // calls plus overhead must fit inside the function limit.
    const INNGEST_FUNCTION_LIMIT_MS = 15 * 60 * 1000;
    expect(CLASSIFY_TIMEOUT_MS * 2).toBeLessThan(INNGEST_FUNCTION_LIMIT_MS);
  });

  it("stays below the threshold where the SDK wants streaming", () => {
    // Above ~16K output the Anthropic SDK recommends streaming to avoid HTTP
    // timeouts. This is a non-streaming call, so going past this is a bigger
    // change than editing a number — it needs .stream() + getFinalMessage().
    expect(CLASSIFY_MAX_TOKENS).toBeLessThanOrEqual(16_000);
  });

  it("is actually higher than the ceiling that was truncating", () => {
    // Guards against a revert-by-accident. 12,000 was the ceiling under which
    // 24 of 78 production runs lost their daily summary.
    expect(CLASSIFY_MAX_TOKENS).toBeGreaterThan(12_000);
  });
});
