// Pure routing logic for the right-click image check (kept out of the
// background entrypoint so it runs under jsdom/vitest).

export type ImageSrcClass = "ok" | "unsupported";

/**
 * Classify a context-menu srcUrl. `data:`/`blob:`/`filesystem:` images have
 * no fetchable public URL — the server (and Hive) can only scan http(s).
 * The server rejects these too (422); classifying client-side just gives
 * the user the friendly copy without a wasted signed request.
 */
export function classifyImageSrc(srcUrl: string): ImageSrcClass {
  return /^https?:\/\//i.test(srcUrl) ? "ok" : "unsupported";
}

/** Confidence → user copy. The honesty guardrail lives here: percentages and
 *  hedged wording only, never a binary FAKE/REAL. */
export function describeConfidence(kind: "ai" | "deepfake", confidence: number): string {
  const pct = Math.round(confidence * 100);
  const noun = kind === "ai" ? "AI-generated" : "a deepfake";
  if (confidence >= 0.9) return `${pct}% likely ${noun}`;
  if (confidence >= 0.5) return `${pct}% — possibly ${noun}`;
  return `${pct}% — no strong signs it's ${noun}`;
}
