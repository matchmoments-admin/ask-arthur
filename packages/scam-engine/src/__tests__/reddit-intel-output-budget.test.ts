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
import { ROUTE_MAX_DURATION_S } from "../inngest/step-budget";

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

  it("keeps the timeout inside the request that carries it", () => {
    // #1134, and the half of the invariant that was missing. The call runs
    // inside a step.run, and every Inngest step executes as ONE HTTP request
    // to a route declaring maxDuration = 300. A timeout at or above that can
    // never fire: Vercel kills the request first and the failure arrives as
    // "HTTP 504 before the SDK responded, no step output was produced" — no
    // attribution, no error row, and the full retry ladder at a 300s slot
    // hold apiece. CLASSIFY_TIMEOUT_MS sat at 360_000 for a month.
    expect(CLASSIFY_TIMEOUT_MS).toBeLessThan(ROUTE_MAX_DURATION_S * 1000);
  });

  it("keeps the output ceiling and the request budget mutually satisfiable", () => {
    // The two assertions above pull in opposite directions: one puts a FLOOR
    // under the timeout (maxTokens / 50 tok/s) and the other a CEILING over it
    // (the request budget). If maxTokens rises far enough the window closes
    // and there is no legal timeout at all — which is exactly the state this
    // file was in at 16,000 tokens, undetected, because nothing compared the
    // two bounds to each other.
    //
    // Go-red: restore CLASSIFY_MAX_TOKENS = 16_000.
    const floorMs = (CLASSIFY_MAX_TOKENS / SLOWEST_TOKENS_PER_SEC) * 1000;
    expect(
      floorMs,
      `A full-length ${CLASSIFY_MAX_TOKENS}-token response needs ${floorMs}ms ` +
        `at the slowest observed rate, but the request is killed at ` +
        `${ROUTE_MAX_DURATION_S * 1000}ms. Lower CLASSIFY_MAX_TOKENS, shrink ` +
        `the batch, or switch to streaming — raising the timeout cannot fix ` +
        `this.`,
    ).toBeLessThan(ROUTE_MAX_DURATION_S * 1000);
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

  it("bounds the DAILY spend, not just the per-run spend", () => {
    // A per-run bound alone would not go red if someone moved the cron to
    // hourly — which is close to what happened: the PR that set this cap also
    // took the trigger from 1 run a day to 4, and the per-run figure hid it.
    // Arrivals, not cadence, set the real total, so this is bounded by the
    // worst case where every run is full.
    const RUNS_PER_DAY = 4; // vercel.json: 0 1,7,13,19 * * *
    const dailyInputTokens =
      (RUNS_PER_DAY * BATCH_SIZE * CLASSIFY_BODY_CHARS) / CHARS_PER_TOKEN;
    const usdPerDay = dailyInputTokens * SONNET_INPUT_USD_PER_TOKEN;
    // REDDIT_INTEL_CAP_USD defaults to 10/day; stay an order of magnitude under
    // it even at the pathological full-batch-every-run rate.
    expect(usdPerDay).toBeLessThan(1);
  });

  it("is long enough to carry a complete victim narrative", () => {
    // The point of v299. A cap at or below the old 500-char excerpt would
    // reintroduce exactly the truncation this replaced.
    expect(CLASSIFY_BODY_CHARS).toBeGreaterThan(2_000);
  });
});
