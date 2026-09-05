/**
 * Chunk boundaries and, above all, ORDER.
 *
 * `embed()` used to hand the provider every text in one request. That was
 * correct at the size it was built for — a Reddit cohort is ~40 posts a day —
 * and stayed correct until a backfill made the cohort 500. Voyage returned
 * 429 (free tier: 3 requests and 10,000 tokens a minute; 500 rows is roughly
 * 50,000 tokens), Inngest retried three times sending the same oversized
 * request each time, and 976 rows were left with no embedding and therefore
 * no theme.
 *
 * The most dangerous property here is not the chunk size, it is the order.
 * Callers match vectors to rows positionally — reddit-intel-embed writes
 * `result.vectors[i]` onto `rows[i]` — so a reordering would attach every
 * embedding to the wrong post, and nothing downstream would ever reveal it:
 * the vectors are valid, the count is right, the writes succeed, and the
 * clustering quietly becomes nonsense.
 */
import { describe, expect, it } from "vitest";

import { __testing } from "../embeddings";

const { chunkTexts, EMBED_CHUNK_TEXTS, EMBED_CHUNK_TOKENS } = __testing;

const short = (n: number) => Array.from({ length: n }, (_, i) => `text ${i}`);

describe("embed chunking", () => {
  it("keeps a small batch as one request", () => {
    // The common path: every query embed, every single-text call. These must
    // not gain a pause or an extra request.
    expect(chunkTexts(short(5))).toHaveLength(1);
    expect(chunkTexts(["one"])).toEqual([["one"]]);
  });

  it("splits on the text count", () => {
    const chunks = chunkTexts(short(EMBED_CHUNK_TEXTS * 3));
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(EMBED_CHUNK_TEXTS);
  });

  it("splits on estimated tokens even when the count is small", () => {
    // The failure was a token ceiling, not a count ceiling. Five very long
    // texts are under any sane count limit and still blow 10,000 tokens.
    const huge = Array.from({ length: 5 }, () => "x".repeat(EMBED_CHUNK_TOKENS * 4));
    expect(chunkTexts(huge).length).toBeGreaterThan(1);
  });

  it("preserves order exactly — the property callers depend on", () => {
    // If this ever fails, every embedding is written to the wrong row and
    // nothing downstream notices.
    const texts = short(EMBED_CHUNK_TEXTS * 4 + 7);
    expect(chunkTexts(texts).flat()).toEqual(texts);
  });

  it("loses nothing and duplicates nothing", () => {
    const texts = short(EMBED_CHUNK_TEXTS * 2 + 1);
    const flat = chunkTexts(texts).flat();
    expect(flat).toHaveLength(texts.length);
    expect(new Set(flat).size).toBe(texts.length);
  });

  it("never emits an empty chunk", () => {
    // An empty chunk would become a provider request for zero inputs, which
    // some providers reject outright.
    for (const n of [0, 1, EMBED_CHUNK_TEXTS, EMBED_CHUNK_TEXTS + 1, 500]) {
      for (const c of chunkTexts(short(n))) expect(c.length).toBeGreaterThan(0);
    }
  });

  it("puts a single oversized text in its own chunk rather than dropping it", () => {
    const texts = ["ok", "y".repeat(EMBED_CHUNK_TOKENS * 8), "ok2"];
    const chunks = chunkTexts(texts);
    expect(chunks.flat()).toEqual(texts);
  });

  it("keeps the 500-row cohort that broke production under the ceiling", () => {
    // The actual shape: reddit-intel-embed loads up to 500 rows, each a short
    // structured summary of roughly 400 characters.
    const cohort = Array.from({ length: 500 }, () => "z".repeat(400));
    const chunks = chunkTexts(cohort);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const tokens = c.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
      // One chunk may exceed the target only when a SINGLE text does.
      if (c.length > 1) expect(tokens).toBeLessThanOrEqual(EMBED_CHUNK_TOKENS);
    }
  });
});
