// Lightweight charity-intent detector for the main /api/analyze route.
//
// When a user pastes "Donate to ABN 11005357522 bushfire appeal" or
// "Is the Cancer Council legit?" into the homepage scam-checker, we want
// to surface a CTA pointing at /charity-check pre-filled with whatever
// we could extract — instead of routing the input through the generic
// scam-analysis pipeline alone.
//
// This is a discoverability NUDGE, not a check. The /charity-check drawer
// is the explicit, deterministic entry point and does the real verification
// (ACNC + ABR registers). Because that drawer backstops every miss, this
// detector is tuned for precision over recall: a missed nudge just yields a
// normal verdict, but a FALSE nudge misroutes the user into the wrong tool.
// It therefore fires only on an explicit charity keyword — a bare 11-digit
// number is not a charity signal (an ABN identifies any Australian
// business, charities included).
//
// The route attaches the returned payload to the response; the result
// component renders it as a deep-link CTA into /charity-check, pre-filled.

// Import from `./abn-checksum` (pure) rather than `./abn-extract` — the
// latter pulls in `fetchShopPage` → `ssrf-dispatcher` → `node:dns`, and
// this module is reachable from `ScamChecker.tsx` (a client component).
import { isValidAbnChecksum } from "./abn-checksum";

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

/** Find the first checksum-valid ABN in `text`.
 *
 *  Two guards stop ad-tracking junk being read as an ABN — the bug that
 *  fired a false charity nudge on a commerce URL whose `gad_campaignid`
 *  query param happened to be 11 digits long:
 *    1. URLs are stripped first — query strings (gad_campaignid, gclid,
 *       gbraid …) are full of long digit runs that are not ABNs.
 *    2. Every 11-digit candidate must pass the official modulus-89 ABN
 *       checksum, which rejects phone numbers, order IDs and campaign IDs
 *       that merely happen to be 11 digits long.
 *
 *  Scans digit/space/dash runs so "11005357522", "11 005 357 522" and
 *  "11-005-357-522" all collapse to the same digits-only form. */
function extractAbn(text: string): string | undefined {
  const withoutUrls = text.replace(
    /(?:https?:\/\/)?[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?/gi,
    " ",
  );
  for (const m of withoutUrls.matchAll(/[\d][\d\s-]{8,18}[\d]/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length === 11 && isValidAbnChecksum(digits)) return digits;
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

  // Precision gate — fire only on an explicit charity keyword. A bare
  // ABN-shaped number is not charity intent (an ABN identifies any
  // Australian business, charities included); the /charity-check drawer
  // is the explicit path for a number-only check.
  if (!hasKeyword) return null;

  const extractedAbn = extractAbn(trimmed);

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
