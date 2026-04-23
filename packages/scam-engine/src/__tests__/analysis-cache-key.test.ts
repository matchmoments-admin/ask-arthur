import { describe, it, expect } from "vitest";
import { buildAnalyzeCacheKey } from "../analysis-cache";

// These tests only exercise the pure key-building function — no Redis
// needed. They lock in the invariants that make the cache correct:
// different inputs must produce different keys; identical inputs must
// produce identical keys.

describe("buildAnalyzeCacheKey", () => {
  it("produces the same key for identical inputs (determinism)", async () => {
    const a = await buildAnalyzeCacheKey({ text: "hello", mode: "text" });
    const b = await buildAnalyzeCacheKey({ text: "hello", mode: "text" });
    expect(a).toBe(b);
  });

  it("produces different keys for different text", async () => {
    const a = await buildAnalyzeCacheKey({ text: "hello" });
    const b = await buildAnalyzeCacheKey({ text: "world" });
    expect(a).not.toBe(b);
  });

  it("produces different keys for text-only vs image-only", async () => {
    const a = await buildAnalyzeCacheKey({ text: "hello" });
    const b = await buildAnalyzeCacheKey({ images: ["aGVsbG8="] });
    expect(a).not.toBe(b);
  });

  it("produces different keys for different images, same text", async () => {
    const a = await buildAnalyzeCacheKey({ text: "hi", images: ["img1base64"] });
    const b = await buildAnalyzeCacheKey({ text: "hi", images: ["img2base64"] });
    expect(a).not.toBe(b);
  });

  it("is order-sensitive for image arrays (multi-image conversations)", async () => {
    // Swapping image order in a multi-image screenshot thread is a different
    // request — first screenshot in the conversation has different meaning
    // than the second. Keys must reflect that.
    const a = await buildAnalyzeCacheKey({ images: ["img1", "img2"] });
    const b = await buildAnalyzeCacheKey({ images: ["img2", "img1"] });
    expect(a).not.toBe(b);
  });

  it("flags hash changes the key", async () => {
    const a = await buildAnalyzeCacheKey({
      text: "hi",
      outputAffectingFlags: { redirectResolve: false },
    });
    const b = await buildAnalyzeCacheKey({
      text: "hi",
      outputAffectingFlags: { redirectResolve: true },
    });
    expect(a).not.toBe(b);
  });

  it("flags hash is canonical (key-order-insensitive)", async () => {
    const a = await buildAnalyzeCacheKey({
      text: "hi",
      outputAffectingFlags: { redirectResolve: true, phoneIntelligence: false },
    });
    const b = await buildAnalyzeCacheKey({
      text: "hi",
      outputAffectingFlags: { phoneIntelligence: false, redirectResolve: true },
    });
    expect(a).toBe(b);
  });

  it("mode tag distinguishes text-only, image-only, and mixed inputs", async () => {
    const t = await buildAnalyzeCacheKey({ text: "hi" });
    const i = await buildAnalyzeCacheKey({ images: ["img1"] });
    const ti = await buildAnalyzeCacheKey({ text: "hi", images: ["img1"] });
    expect(t).toMatch(/:modeT$/);
    expect(i).toMatch(/:modeI$/);
    expect(ti).toMatch(/:modeTI$/);
  });

  it("model axis separates different models", async () => {
    const a = await buildAnalyzeCacheKey({ text: "hi", modelShort: "haiku45" });
    const b = await buildAnalyzeCacheKey({ text: "hi", modelShort: "sonnet45" });
    expect(a).not.toBe(b);
  });

  it("key starts with the versioned prefix", async () => {
    const key = await buildAnalyzeCacheKey({ text: "hi" });
    expect(key.startsWith("askarthur:analysis:p")).toBe(true);
  });

  it("handles empty input gracefully (no text, no images)", async () => {
    // Pathological: shouldn't happen in practice (caller validates upstream)
    // but the key builder must not throw.
    await expect(buildAnalyzeCacheKey({})).resolves.toMatch(/:modeU$/);
  });
});
