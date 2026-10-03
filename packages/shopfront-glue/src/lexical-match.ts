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
import { SHORT_BRAND_NEIGHBOUR_WORDS } from "./short-brand-neighbour-words";

/**
 * The matcher's methodology version, stamped on every monthly brand-store row
 * (clone_watch_monthly_brand_stats.matcher_version, v325) so a month-over-month
 * delta across a version change reads as OUR change, not the attackers'.
 *
 * Bump it in the same commit as any change to what this Module matches.
 * v4 = #1082 (gated confusable rule + 5-char Levenshtein neighbourhood) and
 * #1085 (separator strip before the contiguity check); June–August 2026 were
 * re-classified under v4 on 2026-09-04, so the v325 backfill stamps them 'v4'.
 * v5 = #1150: two recovery paths for the 5-char neighbourhood v4 gated shut
 * (homoglyph substitution; `openShortNeighbourhood` brands), both floored by
 * the neighbour-word denylist. Strictly additive: every v4 match is a v5 match.
 * The same version also carries #1084's bulk-registration fold in the monthly
 * store (`targeting_events`), so a v4 month and a v5 month are never compared.
 */
export const LEXICAL_MATCHER_VERSION = "v5";

/**
 * Which matcher a PERIOD was ingested under — the version the monthly store
 * stamps (#1262 review, D2). Stamping `LEXICAL_MATCHER_VERSION` at WRITE time
 * was a hazard: re-publishing September after the v5 merge would relabel a
 * v4-ingested month as v5 and switch off the month-over-month suppression.
 *
 * Matching happens at ingest, so the honest label is a function of the month,
 * not of the code that happens to fold it. Each entry is the first month
 * (`YYYY-MM-01`) ingested under that version; earlier months take the first
 * entry (June–August 2026 were re-classified under v4 on 2026-09-04).
 *
 * v5's cut-over is 2026-10-01 because the merge is scheduled for 1 October
 * after 11:00 UTC; October carries under a day of v4 ingestion (the 1 Oct
 * 08:30 UTC run). If the merge slips into a later month, move this date to
 * that month in the same PR. The last entry must equal
 * LEXICAL_MATCHER_VERSION (pinned by a test), so the next bump cannot forget
 * to add its own cut-over.
 */
export const MATCHER_VERSION_CUTOVERS: ReadonlyArray<{ from: string; version: string }> = [
  { from: "2026-06-01", version: "v4" },
  { from: "2026-10-01", version: "v5" },
];

/** The first month ingested under v5 — also where targeting events begin. */
export const MATCHER_V5_FROM = MATCHER_VERSION_CUTOVERS.find((c) => c.version === "v5")!.from;

export function matcherVersionForPeriod(periodMonth: string): string {
  const month = periodMonth.slice(0, 10);
  let version = MATCHER_VERSION_CUTOVERS[0]!.version;
  for (const c of MATCHER_VERSION_CUTOVERS) if (month >= c.from) version = c.version;
  return version;
}

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
// At/above this length a 1-edit neighbourhood is sparse enough to trust, so
// the hit needs no further justification; below it, see the gate at the
// Levenshtein branch.
//
// MEASURED, not chosen (August 2026 cohort, 1,032 candidates). 7 looked
// tidier and was badly wrong: amazon / google / qantas are all SIX characters,
// so a cut at 7 dropped amaz0n.lol, amažon.com, åmazon.net, xn--amazn-3ta.net,
// g0ogle.net, gooqle.cfd, googlle.id, qantos.site — the highest-value squats
// in the set. The false positives are a five-character phenomenon (bonds,
// stake, kmart, ubank, coles, mecca, hesta, iinet, shein, sapol), because
// that is where the 1-edit neighbourhood is dense with real English words.
const MIN_BRAND_LEN_FOR_UNGATED_LEVENSHTEIN = 6;
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

// Per-watchlist index, built once and cached by watchlist-array identity.
// The daily ingest calls lexicalMatch ~70k times against the SAME
// AU_BRAND_WATCHLIST reference; without this every call re-normalised every
// brand (O(domains × brands) regex ops) and re-scanned each entry's
// legitimate-domain list (O(domains × brands) string compares). Building the
// index once turns both into O(brands) total + O(1) per-domain lookups —
// load-bearing now the watchlist is growing past ~150 brands. WeakMap keying
// means a custom watchlist passed by a test gets its own index and is GC'd
// with the array (no leak, no cross-test bleed).
interface IndexToken {
  entry: BrandEntry;
  token: string; // normalised brand OR alias used for matching
}
interface WatchlistIndex {
  legitSet: Set<string>;
  tokens: IndexToken[];
}
const indexCache = new WeakMap<BrandEntry[], WatchlistIndex>();

function normaliseToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getWatchlistIndex(watchlist: BrandEntry[]): WatchlistIndex {
  const cached = indexCache.get(watchlist);
  if (cached) return cached;
  const legitSet = new Set<string>();
  const tokens: IndexToken[] = [];
  for (const entry of watchlist) {
    for (const d of entry.legitimate_domains) legitSet.add(d.toLowerCase());
    // Brand token first so it wins same-score ties over its own aliases.
    const brandToken = normaliseToken(entry.brand);
    if (brandToken) tokens.push({ entry, token: brandToken });
    for (const alias of entry.aliases ?? []) {
      const t = normaliseToken(alias);
      if (t) tokens.push({ entry, token: t });
    }
  }
  const index: WatchlistIndex = { legitSet, tokens };
  indexCache.set(watchlist, index);
  return index;
}

export function lexicalMatch(
  domain: string,
  watchlist: BrandEntry[] = AU_BRAND_WATCHLIST,
): MatchResult | null {
  const lower = domain.toLowerCase().trim();
  if (!lower) return null;

  const index = getWatchlistIndex(watchlist);
  // O(1) self-clone exclusion (was an O(brands) scan per domain).
  if (index.legitSet.has(lower)) return null;

  const labels = lower.split(".");
  const primary = labels[0] ?? lower;

  // IDN decode (PR-E, #494). When the primary label is an A-label
  // (xn--…), decode to Unicode before confusable / substring / Levenshtein
  // checks. `decodeIdnLabel` returns the original input if not an A-label,
  // OR if punycode.toUnicode throws on a malformed value — never throws
  // upward. The DECODED form is what we match against.
  const matchPrimary = decodeIdnLabel(primary);
  const wasIdnDecoded = matchPrimary !== primary;

  // Decode EVERY label so the scam-context gate evaluates the U-label, not
  // raw punycode (#510). Passing the raw `xn--…` form into hasScamContext
  // both false-passes (a literal `xn--au…` satisfies the `au` token) and
  // false-negatives (a decoded scam token never appears). decodeIdnLabel is
  // a no-op on non-A-labels, so this is identity for ASCII domains.
  const decodedDomain = labels.map(decodeIdnLabel).join(".");

  // Hoisted out of the brand loop — both are functions of the domain only,
  // not the brand, so computing them once per call instead of once per brand
  // is a (brands)× reduction in confusable-normalisation + segment-split work.
  const normalisedPrimary = normaliseConfusables(matchPrimary);
  const hasConfusable = normalisedPrimary !== matchPrimary;
  const primarySegments = matchPrimary.split(/[-_]/);

  let best: MatchResult | null = null;

  for (const { entry, token: brand } of index.tokens) {
    // Same length gate the substring rule uses. This branch had NONE — no
    // length gate, no scam-context gate — and it is evaluated FIRST with a
    // `continue`, so the loosest rule pre-empted both guarded ones. A 2-char
    // token therefore matched inside ANY confusable-folded string: all eight
    // confusable hits in the August 2026 cohort were ordinary Russian .рф
    // domains whose Cyrillic folds to Latin and happens to contain "ey"
    // (всеумею, жидкийлинолеум, неурокех). The reasoning in the
    // MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING comment above always applied here too;
    // it was just never carried across.
    const confusableHit =
      brand.length >= MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING
        ? normalisedPrimary.includes(brand)
        : normalisedPrimary.split(/[-_]/).includes(brand);
    if (hasConfusable && confusableHit) {
      best = pickBetter(best, {
        brand: entry.brand,
        legitimate_domain: entry.legitimate_domains[0] ?? "",
        score: 0.9,
        signal_type: "confusable",
        evidence: wasIdnDecoded
          ? { input_label: primary, idn_decoded: matchPrimary, normalised: normalisedPrimary, brand }
          : { input_label: primary, normalised: normalisedPrimary, brand },
      });
      continue;
    }

    const substringHit =
      brand.length >= MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING
        ? matchPrimary.includes(brand)
        : primarySegments.includes(brand);
    if (substringHit && hasScamContext(decodedDomain, matchPrimary, brand)) {
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
      // FP gate for SHORT brands only (v4, #1082).
      //
      // The 1-edit neighbourhood of a 5-char brand is dense with ordinary
      // words — bonus/bands/bounds/bones from "bonds", stage/snake/shake from
      // "stake", mart from "kmart", bank from "ubank", festa/nesta from
      // "hesta" — and this rule produced 52% of all matches with no FP gate at
      // all. August 2026: bonds.com.au carried 28 hits of which ~21 were this
      // class (including gonds.* × 9, one bulk registration).
      //
      // But a blanket context gate is WRONG, and the v2 tests say so: the
      // whole point of this rule is to catch bare misspellings that have no
      // context token (`qkmart.com`, `bunings.net`). So gate on what actually
      // separates them:
      //
      //   * long brand (≥7)      — its 1-edit neighbourhood has no real words;
      //                            `bunings.net` (bunnings) stays caught.
      //   * brand still present  — an INSERTION typo (`qkmart`, `kmartz`,
      //                            `2kmart`) keeps the brand contiguous; that
      //                            is a squat, not a coincidence. Separators
      //                            are stripped first, because inserting one
      //                            INTO a brand is the canonical shape —
      //                            `fed-ex.space` (urlscan: likely_phishing,
      //                            weaponised 2026-08-03) was dropped by the
      //                            first cut of this gate for exactly that.
      //   * otherwise            — a substitution/deletion into some other
      //                            word must earn it with a scam-context
      //                            token from OUTSIDE the primary label, so
      //                            `b0nds.shop` fires and `bonus.business`,
      //                            `mart.services`, `bank.camera` do not.
      const shortBrandTrusted =
        brand.length >= MIN_BRAND_LEN_FOR_UNGATED_LEVENSHTEIN ||
        matchPrimary.replace(/[-_]/g, "").includes(brand) ||
        hasScamContextOutsidePrimary(decodedDomain, matchPrimary);
      // v5 (#1150): the v4 gate above is left byte-identical, so every v4
      // match survives. What it gated shut is re-opened on two narrow paths,
      // only when v4 said no — see `shortBrandRecovery`.
      const recovery =
        dist === 1 && !shortBrandTrusted
          ? shortBrandRecovery(matchPrimary, brand, entry)
          : null;
      if (
        dist > 0 &&
        dist <= LEVENSHTEIN_THRESHOLD &&
        (shortBrandTrusted || recovery)
      ) {
        const score = 1 - dist / Math.max(matchPrimary.length, brand.length);
        const evidence: Record<string, string | number> = wasIdnDecoded
          ? {
              input_label: primary,
              idn_decoded: matchPrimary,
              brand,
              edit_distance: dist,
            }
          : { input_label: primary, brand, edit_distance: dist };
        // Which v5 path admitted it — lets a re-triage or an audit select
        // exactly the rows v4 would not have produced.
        if (recovery) evidence.short_brand_gate = recovery;
        best = pickBetter(best, {
          brand: entry.brand,
          legitimate_domain: entry.legitimate_domains[0] ?? "",
          score: Math.min(MAX_MATCH_SCORE, Math.max(0.55, score)),
          signal_type: "levenshtein",
          evidence,
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

/**
 * The primary label as the matcher compares it — IDN-decoded, then
 * confusable-folded. Two candidates with the same key are the same NAME on
 * different TLDs (`gonds.co`, `gonds.online`, …); the monthly cohort folds such
 * a bulk registration into one targeting event (#1084, apps/web clone-cohort.ts).
 */
export function candidateLabelKey(domain: string): string {
  const primary = domain.toLowerCase().trim().split(".")[0] ?? "";
  return normaliseConfusables(decodeIdnLabel(primary));
}

// ── v5 short-brand recovery (#1150) ─────────────────────────────────────────
//
// MEASURED on 90 days of the raw whoisds feed (2026-06-29 → 09-26, 6.64M names)
// and the alert cohort, not reasoned about. v4 gated the 5-char 1-edit
// neighbourhood and lost 9 CONFIRMED threats: appie.{bond,beer,autos,mom,
// beauty}, appve.vu, bonos.buzz, bnds.cl, woles.net.
//
// The obvious fix (#1083: "the false positives are ordinary words, so reject
// words and re-open the rest") is WRONG in the data. Only 152 of the 478
// short-brand labels v4 dropped are dictionary words; the rest are brandables
// and foreign words (xbank, dmart, medex, doula, mocca, iioet, vinet). A word
// denylist alone re-admits 326 of them (~114 a month) at a 2.8% threat rate —
// against 7-9% for what v4 keeps. So the denylist is kept as the FLOOR, and
// admission needs one of two positive reasons:
//
//   * homoglyph — a single visual-confusable substitution (l→i, o→0, e→3, …).
//     Brand-agnostic: `appie` for apple, and #1083's b0nds / c0les / sh3in.
//   * open_neighbourhood — the brand entry opts in (`openShortNeighbourhood`),
//     for brands whose short neighbourhood produced confirmed threats. Any
//     non-word 1-edit label then matches (bonos, bnds, appve). Apple + Bonds
//     only: Coles was measured and declined (woles.net is its one threat,
//     shaped like koles/noles, for +9 alerts) — a known miss.
//
// Together: 8/9 recovered (woles.net is the known miss), 21 domains added to
// the 90-day cohort (8 of them confirmed threats — 38%, against 8.9% for what
// v4 matches), 30 on 90 days of the raw feed (~10 a month), zero dictionary
// words re-admitted, zero v4 matches lost. The denylist carries a small
// foreign/brandable supplement (appli, bonde, bondo, bondy, bondu …; #1262 D3).

/** Brand char → label char. Only pairs a reader's eye substitutes. */
const HOMOGLYPH_SUBSTITUTIONS = new Set([
  "l>i", "i>l", "l>1", "i>1", "o>0", "e>3", "a>4", "s>5", "g>9", "b>8", "t>7", "z>2",
]);

type ShortBrandGate = "homoglyph" | "open_neighbourhood";

function shortBrandRecovery(
  label: string,
  brand: string,
  entry: BrandEntry,
): ShortBrandGate | null {
  // The precision floor, checked first: an ordinary word never matches on
  // either path (bonus, bands, mart, bank, stage, apply, bondi, gonds).
  if (SHORT_BRAND_NEIGHBOUR_WORDS.has(label)) return null;
  if (label.length === brand.length) {
    for (let i = 0; i < label.length; i++) {
      if (label[i] !== brand[i]) {
        if (HOMOGLYPH_SUBSTITUTIONS.has(`${brand[i]}>${label[i]}`)) return "homoglyph";
        break;
      }
    }
  }
  return entry.openShortNeighbourhood ? "open_neighbourhood" : null;
}

function pickBetter(a: MatchResult | null, b: MatchResult): MatchResult {
  if (!a) return b;
  return b.score > a.score ? b : a;
}

/**
 * Scam-context token drawn from anywhere EXCEPT the primary label.
 *
 * `hasScamContext` strips the *brand* from the stem, which is right for a
 * substring hit (the brand is literally there). A Levenshtein hit is different:
 * the whole primary label IS the near-miss, so leaving it in lets the label
 * supply its own justification — `bank.camera` would satisfy the "bank" token
 * with the very word that made it a false positive. Stripping the primary
 * label instead means the token has to come from a subdomain or the gTLD.
 */
function hasScamContextOutsidePrimary(domain: string, primary: string): boolean {
  const labels = domain.split(".");
  const lastLabel = labels.at(-1) ?? "";
  const stem = lastLabel.length <= 2 ? labels.slice(0, -1).join(".") : domain;
  const residue = stem.replaceAll(primary, " ");
  const residueSegments = residue.split(/[-_.]/).filter(Boolean);
  return SCAM_CONTEXT_TOKENS.some((token) =>
    SEGMENT_BOUNDED_TOKENS.has(token)
      ? residueSegments.includes(token)
      : residue.includes(token),
  );
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
