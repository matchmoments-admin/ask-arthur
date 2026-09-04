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
  CLASSIFY_BODY_CHARS,
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

/**
 * The INPUT-budget invariant (v299).
 *
 * The classifier moved from feed_items.description (capped at 500 chars by
 * the scraper) to feed_items.body_md (capped at 20,000). That is a 40x
 * ceiling increase on a single batched call, so the constant that bounds
 * what is actually sent is now the thing standing between this function and
 * a spend multiple. Nothing else enforces it: the brake fires a day late and
 * only after the money is gone.
 */
describe("classify input budget", () => {
  // Rough but stable: ~4 chars per token for English prose.
  const CHARS_PER_TOKEN = 4;
  const BATCH_SIZE = 40; // reddit-intel-trigger's BATCH_SIZE
  const SONNET_INPUT_USD_PER_TOKEN = 3 / 1_000_000;

  it("sends less than it stores", () => {
    // BODY_MD_MAX_CHARS in pipeline/scrapers/reddit_scams.py. Storage is
    // cheap and useful for later reprocessing; prompt input is neither.
    const BODY_MD_MAX_CHARS = 20_000;
    expect(CLASSIFY_BODY_CHARS).toBeLessThan(BODY_MD_MAX_CHARS);
  });

  it("keeps a full batch's input spend well under US$0.20 a run", () => {
    // The regression this prevents: someone raises the cap to "just use the
    // whole body" and a 40-post batch quietly becomes a 200K-token call.
    const inputTokens = (BATCH_SIZE * CLASSIFY_BODY_CHARS) / CHARS_PER_TOKEN;
    const usdPerRun = inputTokens * SONNET_INPUT_USD_PER_TOKEN;
    expect(usdPerRun).toBeLessThan(0.2);
  });

  it("is long enough to carry a complete victim narrative", () => {
    // The point of v299. A cap at or below the old 500-char excerpt would
    // reintroduce exactly the truncation this replaced.
    expect(CLASSIFY_BODY_CHARS).toBeGreaterThan(2_000);
  });
});
