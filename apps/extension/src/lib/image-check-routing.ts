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

/** Hive's generator class slugs → display names. Unknown slugs fall back to
 *  a capitalised form so new Hive classes degrade gracefully. */
const GENERATOR_NAMES: Record<string, string> = {
  midjourney: "Midjourney",
  dalle: "DALL·E",
  stablediffusion: "Stable Diffusion",
  sdxl: "SDXL",
  flux: "Flux",
  bingimagecreator: "Bing Image Creator",
  adobefirefly: "Adobe Firefly",
  firefly: "Adobe Firefly",
  imagen: "Google Imagen",
  ideogram: "Ideogram",
  recraft: "Recraft",
  kandinsky: "Kandinsky",
  gan: "GAN (face generator)",
  hive: "Hive",
  sora: "Sora",
  other_image_generators: "Other AI generator",
};

export function formatGeneratorName(slug: string): string {
  const known = GENERATOR_NAMES[slug.toLowerCase()];
  if (known) return known;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
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
