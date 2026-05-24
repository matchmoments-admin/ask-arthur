// Deterministic lexical matcher for clone-watch Layer 0 — see ADR-0015
// signal model (deterministic-string only at MVP; Voyage embeddings are
// Phase C). Four signal types in priority order:
//
//   1. confusable  — domain contains a brand rendered via Unicode
//                    confusables (cyrillic 'а' for latin 'a', etc.)
//   2. punycode    — domain decodes via punycode to a string containing
//                    the brand
//   3. substring   — brand name appears in the domain label after
//                    normalisation
//   4. levenshtein — domain label is ≤ edit-distance threshold from
//                    the brand
//
// Score is 0..1. A match against the entry's legitimate_domains returns
// null (a brand can't clone itself).

import { AU_BRAND_WATCHLIST, type BrandEntry } from "./au-brand-watchlist";

export type SignalType =
  | "confusable"
  | "punycode"
  | "substring"
  | "levenshtein";

export interface MatchResult {
  brand: string;
  legitimate_domain: string;
  score: number;
  signal_type: SignalType;
  evidence: Record<string, string | number>;
}

// Common cyrillic / greek / fullwidth → latin confusables. Not exhaustive;
// extend as we see real-world hits. Keys are confusable characters; values
// are their latin equivalents.
const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
  "А": "a", "В": "b", "Е": "e", "К": "k", "М": "m", "Н": "h", "О": "o",
  "Р": "p", "С": "c", "Т": "t", "Х": "x",
  "ο": "o", "α": "a", "ν": "v", "ρ": "p", "τ": "t",
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
};

const LEVENSHTEIN_THRESHOLD = 2;
const MIN_BRAND_LEN_FOR_LEVENSHTEIN = 5;

export function lexicalMatch(
  domain: string,
  watchlist: BrandEntry[] = AU_BRAND_WATCHLIST,
): MatchResult | null {
  const lower = domain.toLowerCase().trim();
  if (!lower) return null;

  for (const entry of watchlist) {
    if (entry.legitimate_domains.includes(lower)) return null;
  }

  const labels = lower.split(".");
  const primary = labels[0] ?? lower;

  let best: MatchResult | null = null;

  for (const entry of watchlist) {
    const brand = entry.brand.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!brand) continue;

    const punycodeForm = decodePunycode(primary);
    if (punycodeForm && punycodeForm.includes(brand)) {
      best = pickBetter(best, {
        brand: entry.brand,
        legitimate_domain: entry.legitimate_domains[0] ?? "",
        score: 0.95,
        signal_type: "punycode",
        evidence: { input_label: primary, decoded: punycodeForm, brand },
      });
      continue;
    }

    const normalised = normaliseConfusables(primary);
    if (normalised !== primary && normalised.includes(brand)) {
      best = pickBetter(best, {
        brand: entry.brand,
        legitimate_domain: entry.legitimate_domains[0] ?? "",
        score: 0.9,
        signal_type: "confusable",
        evidence: { input_label: primary, normalised, brand },
      });
      continue;
    }

    if (primary.includes(brand)) {
      best = pickBetter(best, {
        brand: entry.brand,
        legitimate_domain: entry.legitimate_domains[0] ?? "",
        score: 0.85,
        signal_type: "substring",
        evidence: { input_label: primary, brand },
      });
      continue;
    }

    if (brand.length >= MIN_BRAND_LEN_FOR_LEVENSHTEIN) {
      const dist = levenshtein(primary, brand);
      if (dist > 0 && dist <= LEVENSHTEIN_THRESHOLD) {
        const score = 1 - dist / Math.max(primary.length, brand.length);
        best = pickBetter(best, {
          brand: entry.brand,
          legitimate_domain: entry.legitimate_domains[0] ?? "",
          score: Math.min(0.8, Math.max(0.55, score)),
          signal_type: "levenshtein",
          evidence: { input_label: primary, brand, edit_distance: dist },
        });
      }
    }
  }

  return best;
}

function pickBetter(a: MatchResult | null, b: MatchResult): MatchResult {
  if (!a) return b;
  return b.score > a.score ? b : a;
}

function normaliseConfusables(input: string): string {
  let out = "";
  for (const ch of input) {
    out += CONFUSABLES[ch] ?? ch;
  }
  return out;
}

function decodePunycode(label: string): string | null {
  if (!label.startsWith("xn--")) return null;
  try {
    const url = new URL(`https://${label}.invalid/`);
    return url.hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}
