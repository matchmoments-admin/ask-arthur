// Lightweight charity-intent detector for the main /api/analyze route.
//
// When a user pastes "Donate to ABN 11005357522 bushfire appeal" or
// "Is the Cancer Council legit?" into the homepage scam-checker, we want
// to surface a CTA pointing at /charity-check pre-filled with whatever
// we could extract — instead of routing the input through the generic
// scam-analysis pipeline alone.
//
// This module is pure (no I/O, no external calls); it returns a small
// payload the route attaches to the response and the result component
// renders as a deep-link CTA. The /charity-check engine still does the
// real verification — this is just the discoverability bridge per the
// strategy memo §1 "hybrid placement" recommendation.

const CHARITY_KEYWORDS = [
  "charity",
  "charities",
  "donat", // donate, donation, donating
  "fundrais", // fundraiser, fundraising
  "appeal",
  "acnc",
  "deductible gift",
  "tax-deductible",
  "tax deductible",
  "gofundme",
];

// Heuristic name-extraction patterns. Order matters — first match wins.
// Quoted-name fires FIRST because users who paste a charity's name in
// quotes are giving us the strongest signal of where the name ends.
const NAME_PATTERNS: RegExp[] = [
  // Words wrapped in straight or curly quotes — strongest delimiter.
  /["“]([A-Z][A-Za-z'. -]{3,80})["”]/,
  // "donate to <Name>" / "donation for <Name>" / "fundraising for <Name>".
  // Prefix is case-folded inline (no /i flag) so the capture group's
  // [A-Z] anchor stays strict — otherwise lowercase trailing words like
  // "today" get sucked into the name.
  /(?:[Dd]onate to|[Dd]onation for|[Aa]ppeal for|[Ff]undraising for|[Ss]upport(?:ing)?|[Gg]iving to|[Gg]ive to)\s+(?:[Tt]he\s+)?([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,5})/,
  // "<Name> Foundation/Society/Council/etc." — last because it's the
  // weakest delimiter (boundary at the suffix word, not at content).
  /\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,5})\s+(?:Charity|Appeal|Foundation|Fund|Society|Trust|Council)\b/,
];

/** Find the first 11-digit ABN-shaped substring in `text`. Returns the
 *  digits-only form, or undefined if no candidate matched. We scan
 *  digit/space/dash runs and validate digit count rather than relying on
 *  a single complex regex — easier to keep correct for "11005357522",
 *  "11 005 357 522", and "11-005-357-522" all at once. */
function extractAbn(text: string): string | undefined {
  for (const m of text.matchAll(/[\d][\d\s-]{8,18}[\d]/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length === 11) return digits;
  }
  return undefined;
}

export interface CharityIntent {
  /** True when at least one charity keyword OR an ABN was detected. */
  detected: true;
  /** 11-digit ABN if extractable from the input. */
  extractedAbn?: string;
  /** Best-effort charity-name candidate. May be wrong; the consumer UI
   *  treats this as a pre-fill, not a confirmed match. */
  extractedName?: string;
}

/**
 * Detect charity-intent in a free-text submission.
 *
 * Returns a CharityIntent payload with whatever could be extracted, or
 * null when the input doesn't look charity-shaped at all. Designed to
 * be cheap (no network, just regex) and side-effect-free so it's safe
 * to call on every /api/analyze request.
 */
export function detectCharityIntent(text: string | null | undefined): CharityIntent | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 5000) return null;

  const lower = trimmed.toLowerCase();
  const hasKeyword = CHARITY_KEYWORDS.some((k) => lower.includes(k));

  const extractedAbn = extractAbn(trimmed);

  // No charity-shaped signals → don't fire the CTA.
  if (!hasKeyword && !extractedAbn) return null;

  let extractedName: string | undefined;
  for (const re of NAME_PATTERNS) {
    const m = trimmed.match(re);
    if (m && m[1]) {
      // Strip leading articles/quotes that crept past the regex anchor.
      const candidate = m[1].replace(/^["“'\s]+|["”'\s]+$/g, "").trim();
      if (candidate.length >= 3 && candidate.length <= 100) {
        extractedName = candidate;
        break;
      }
    }
  }

  return {
    detected: true,
    ...(extractedAbn && { extractedAbn }),
    ...(extractedName && { extractedName }),
  };
}
