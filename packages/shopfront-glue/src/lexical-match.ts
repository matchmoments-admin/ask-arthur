// Deterministic lexical matcher for clone-watch Layer 0 — see ADR-0015
// signal model (deterministic-string only at MVP; Voyage embeddings are
// Phase C). Three signal types in priority order:
//
//   1. confusable  — domain contains a brand rendered via Unicode
//                    confusables (cyrillic 'а' for latin 'a', etc.)
//   2. substring   — brand name appears in the domain label after
//                    normalisation
//   3. levenshtein — domain label is exactly 1 edit-distance from
//                    the brand (distance-2 produces too many false
//                    positives on legitimate AU domains — `bondi.com.au`
//                    vs "Bonds", `targets.shop` vs "Target")
//
// Score is 0..1; bounded < 1.0 so brand_match_score * 40 stays below
// the `medium` severity boundary at MVP. A match against the entry's
// legitimate_domains returns null (a brand can't clone itself).
//
// Punycode / IDN homograph decoding is NOT covered at MVP. Node's
// URL constructor does not decode A-labels (xn--...) to Unicode, so
// the historical "punycode" signal was dead code. A-label substring
// matches (e.g. `xn--bunnings-cn1c.shop` contains the latin string
// "bunnings") still fire via the `substring` branch. Real IDN
// decoding is a Phase B concern.

import { AU_BRAND_WATCHLIST, type BrandEntry } from "./au-brand-watchlist";

export type SignalType = "confusable" | "substring" | "levenshtein";

export interface MatchResult {
  brand: string;
  legitimate_domain: string;
  score: number;
  signal_type: SignalType;
  evidence: Record<string, string | number>;
}

// Lowercase cyrillic / greek / fullwidth → latin confusables. Uppercase
// entries removed: `domain.toLowerCase()` runs before normalisation so
// uppercase keys are unreachable.
const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
  "і": "i", "ј": "j", "ѕ": "s",
  "ο": "o", "α": "a", "ν": "v", "ρ": "p", "τ": "t",
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
};

const LEVENSHTEIN_THRESHOLD = 1;
const MIN_BRAND_LEN_FOR_LEVENSHTEIN = 5;
const MAX_MATCH_SCORE = 0.95;

// Substring threshold: brands ≥ this length match anywhere in the
// primary label. Shorter brands (3-char "ANZ" / "NAB" / "IGA",
// 4-char "Aldi" / "Toll") need a stricter check — `anz` as a raw
// substring matches `franzese.com`, `lanzhoudhl.com`, `nathanz.art`,
// and hundreds of other non-clone domains. First prod run produced
// 137+85 hits each on ANZ + NAB before this gate. For short brands
// we require the brand to appear as a standalone segment of the
// primary label (split by - or _).
const MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING = 5;

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

    const substringHit =
      brand.length >= MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING
        ? primary.includes(brand)
        : primary.split(/[-_]/).includes(brand);
    if (substringHit) {
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
          score: Math.min(MAX_MATCH_SCORE, Math.max(0.55, score)),
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
