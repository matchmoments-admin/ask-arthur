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
// Punycode / IDN homograph decoding (PR-E, #494). Domain registered as
// `xn--…` (an A-label) is decoded to its Unicode form before lexical
// matching. Catches clones like:
//   xn--auspst-9ya.com  → ausp̃st.com  → confusable-normalises to auspost
// A-label substring hits still fire on the raw form when the latin
// chars happen to align (e.g. xn--bunnings-cn1c.shop literally contains
// "bunnings") — that path is preserved as a fallback.
//
// Cyrillic / Greek / Latin-extended confusables on the bare ASCII form
// were already handled via CONFUSABLES below; this PR adds the IDN
// decode step in front of that. Wider confusables coverage tracked in
// BACKLOG.md #29.

// Node 24 ships `node:punycode` as deprecated-but-present. We use it
// here because the matcher is server-only (Inngest + cron) and adding a
// userland dep for one function is heavier than the deprecation
// warning. If Node ever removes it, swap to the `punycode/` package
// (zero behaviour change).
//
// eslint-disable-next-line @typescript-eslint/no-require-imports
import punycode from "node:punycode";

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

// Scam-context-token gate on substring hits (v2 matcher, issue #405).
// Second prod run after the #403 word-boundary fix surfaced ~70% FP rate
// from common English words containing a brand substring: "Greece" →
// reece (3/17), "carpentry" → target (multiple), "auto-école" → coles,
// "surname Coles" → coles. Pattern: brand embedded mid-word in a segment
// that's otherwise unrelated to commerce/auth.
//
// Gate: a substring hit only fires if either
//   (a) the primary label IS the brand exactly — bare brand on a
//       non-legitimate TLD is impersonation by definition (westpac.com,
//       cba.net, kfc.shop)
//   (b) at least one scam-context token appears in the domain with the
//       brand stripped and 2-char ccTLDs dropped (so `.com.au` doesn't
//       leak the `au` token universally)
//
// Known FN trade-off: `kfc-net.net` (KFC) and similar short-brand
// substring hits with no context token — short brands (<5 chars) skip
// Levenshtein entirely (see MIN_BRAND_LEN_FOR_LEVENSHTEIN), so substring
// is their only path. Phase A scanner (#376) picks these up via DNS/
// content inspection. Long-brand 1-char-edit typosquats (`qkmart.com`,
// `kmartz.com`) keep firing via the Levenshtein branch, which remains
// ungated — single-edit typos are already scoped tightly enough.
//
// Token-as-TLD note: `shop`, `online`, `store`, `bank`, `support` are
// all both context tokens AND legitimate gTLDs. The 2-char-ccTLD drop
// keeps these (≥4 chars), so any brand-substring hit on `.shop` /
// `.online` / `.store` / `.bank` / `.support` auto-passes the gate.
// Intentional — `.shop` is itself a scam-storefront signal.
const SCAM_CONTEXT_TOKENS = [
  "bank", "login", "support", "ads", "online", "secure", "verify",
  "pay", "home", "shop", "store", "account", "au",
];

// v3 matcher (#409). `au` is the only token <3 chars in the list. As a raw
// substring it leaks on any domain whose primary label starts with the
// letters "au" — `autoecolesoultbycfconduite.fr` (French driving school,
// Coles FP), `auction-*`, `audio-*`, `australia-*` (without .au). Day-1
// prod evidence (2026-05-24) caught the auto-école case. Other tokens in
// the list are ≥3 chars and naturally word-boundary-safe (`pay` matches
// `paypal-secure.shop` correctly, `bank` matches `cba-bank.info`).
//
// Treat segment-bounded tokens as primary-label-segment matches only:
// the token must appear between `-` / `_` / `.` separators in the
// brand-stripped residue. Preserves the `westpac-au.com` TP signal
// (segment "au" between `-` and `.`); kills the `autoeoultbycf...` FP
// class (no segment break before "au").
const SEGMENT_BOUNDED_TOKENS = new Set(["au"]);

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

  // IDN decode (PR-E, #494). When the primary label is an A-label
  // (xn--…), decode to Unicode before confusable / substring / Levenshtein
  // checks. `decodeIdnLabel` returns the original input if not an A-label,
  // OR if punycode.toUnicode throws on a malformed value — never throws
  // upward. The DECODED form is what we match against.
  const matchPrimary = decodeIdnLabel(primary);
  const wasIdnDecoded = matchPrimary !== primary;

  let best: MatchResult | null = null;

  for (const entry of watchlist) {
    const brand = entry.brand.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!brand) continue;

    const normalised = normaliseConfusables(matchPrimary);
    if (normalised !== matchPrimary && normalised.includes(brand)) {
      best = pickBetter(best, {
        brand: entry.brand,
        legitimate_domain: entry.legitimate_domains[0] ?? "",
        score: 0.9,
        signal_type: "confusable",
        evidence: wasIdnDecoded
          ? { input_label: primary, idn_decoded: matchPrimary, normalised, brand }
          : { input_label: primary, normalised, brand },
      });
      continue;
    }

    const substringHit =
      brand.length >= MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING
        ? matchPrimary.includes(brand)
        : matchPrimary.split(/[-_]/).includes(brand);
    if (substringHit && hasScamContext(lower, matchPrimary, brand)) {
      best = pickBetter(best, {
        brand: entry.brand,
        legitimate_domain: entry.legitimate_domains[0] ?? "",
        score: 0.85,
        signal_type: "substring",
        evidence: wasIdnDecoded
          ? { input_label: primary, idn_decoded: matchPrimary, brand }
          : { input_label: primary, brand },
      });
      continue;
    }

    if (brand.length >= MIN_BRAND_LEN_FOR_LEVENSHTEIN) {
      const dist = levenshtein(matchPrimary, brand);
      if (dist > 0 && dist <= LEVENSHTEIN_THRESHOLD) {
        const score = 1 - dist / Math.max(matchPrimary.length, brand.length);
        best = pickBetter(best, {
          brand: entry.brand,
          legitimate_domain: entry.legitimate_domains[0] ?? "",
          score: Math.min(MAX_MATCH_SCORE, Math.max(0.55, score)),
          signal_type: "levenshtein",
          evidence: wasIdnDecoded
            ? {
                input_label: primary,
                idn_decoded: matchPrimary,
                brand,
                edit_distance: dist,
              }
            : { input_label: primary, brand, edit_distance: dist },
        });
      }
    }
  }

  return best;
}

/**
 * Decode a single domain label from punycode (A-label) to Unicode (U-label)
 * when the label starts with the IDNA `xn--` prefix. Returns the original
 * input on any non-A-label OR on malformed punycode (punycode.toUnicode
 * can throw on certain inputs — we treat those as opaque ASCII).
 *
 * Examples:
 *   `xn--auspst-9ya`  → "ausp̃st"     (small letter p with tilde)
 *   `xn--bunnings-cn1c` → "bunnings象" (latin "bunnings" + a CJK ideograph)
 *   `auspost`          → "auspost"    (no transform)
 *   `xn---broken-broken` → "xn---broken-broken" (malformed, returned as-is)
 *
 * Exported for unit-testing.
 */
export function decodeIdnLabel(label: string): string {
  if (!label.startsWith("xn--")) return label;
  try {
    return punycode.toUnicode(label);
  } catch {
    return label;
  }
}

function pickBetter(a: MatchResult | null, b: MatchResult): MatchResult {
  if (!a) return b;
  return b.score > a.score ? b : a;
}

function hasScamContext(domain: string, primary: string, brand: string): boolean {
  // Exception (a): bare brand on a non-legitimate TLD always fires.
  // Caller has already filtered legitimate-domain exact matches upstream.
  if (primary === brand) return true;

  // Drop a 2-char final label (ccTLDs like .au, .uk, .fr) so the universal
  // `.com.au` suffix doesn't satisfy the `au` token for every Australian
  // domain. gTLDs (.shop, .info, .org, .net) are kept — `.shop` is itself
  // a scam-storefront signal.
  const labels = domain.split(".");
  const lastLabel = labels.at(-1) ?? "";
  const stem = lastLabel.length <= 2 ? labels.slice(0, -1).join(".") : domain;

  // replaceAll (not replace) so a brand appearing twice in the domain
  // doesn't leak its own letters into the residue and accidentally
  // satisfy a token. Latent foot-gun if a future watchlist brand equals
  // a context token (e.g. a "Shop"/"Pay"/"Home"-named brand).
  const residue = stem.replaceAll(brand, " ");
  const residueSegments = residue.split(/[-_.]/).filter(Boolean);
  return SCAM_CONTEXT_TOKENS.some((token) =>
    SEGMENT_BOUNDED_TOKENS.has(token)
      ? residueSegments.includes(token)
      : residue.includes(token),
  );
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
