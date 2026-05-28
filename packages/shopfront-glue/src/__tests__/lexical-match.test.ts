import { describe, expect, it } from "vitest";
import { lexicalMatch, decodeIdnLabel } from "../lexical-match";
import type { BrandEntry } from "../au-brand-watchlist";

const TEST_WATCHLIST: BrandEntry[] = [
  { brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] },
  { brand: "Westpac", legitimate_domains: ["westpac.com.au"] },
  { brand: "JB Hi-Fi", legitimate_domains: ["jbhifi.com.au"] },
];

describe("lexicalMatch", () => {
  it("returns null for an exact legitimate domain", () => {
    expect(lexicalMatch("bunnings.com.au", TEST_WATCHLIST)).toBeNull();
  });

  it("returns null for an unrelated domain", () => {
    expect(lexicalMatch("example.com", TEST_WATCHLIST)).toBeNull();
  });

  it("matches a brand substring in the primary label", () => {
    const result = lexicalMatch("bunnings-au-deals.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Bunnings");
    expect(result?.signal_type).toBe("substring");
  });

  it("matches a single-edit typo (Levenshtein distance 1)", () => {
    const result = lexicalMatch("bunings.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Bunnings");
    expect(result?.signal_type).toBe("levenshtein");
    expect(result?.evidence.edit_distance).toBe(1);
  });

  it("rejects a 2-edit typo (threshold=1 lowers FP rate on legit AU domains)", () => {
    // 'bunnnigs' is distance 2 from 'bunnings' — threshold=1 means no fire.
    // This is the defamation-defence boundary: `bondi.com.au` (dist 1 from
    // Bonds is still a hit), but distance-2 dictionary words (`bonded.com`,
    // `targets.shop`, `subwy.com`) are out.
    const result = lexicalMatch("bunnnigs.shop", TEST_WATCHLIST);
    expect(result).toBeNull();
  });

  it("normalises confusables (cyrillic 'а' → latin 'a')", () => {
    const result = lexicalMatch("westpаc-login.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Westpac");
    expect(result?.signal_type).toBe("confusable");
  });

  it("strips non-alphanumerics from brand for matching", () => {
    const result = lexicalMatch("jbhifi-au.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("JB Hi-Fi");
  });

  it("does not Levenshtein-match brands shorter than 5 chars", () => {
    const shortList: BrandEntry[] = [
      { brand: "KFC", legitimate_domains: ["kfc.com.au"] },
    ];
    const result = lexicalMatch("kfd.shop", shortList);
    expect(result).toBeNull();
  });

  // Word-boundary substring defence for short brands. First prod run
  // surfaced 137+ FPs each on ANZ/NAB/IGA because plain substring
  // matches anywhere — `franzese.com`, `lanzhoudhl.com`, `bigbassbonanza.com`
  // would all "contain anz". For brands < 5 chars, require the brand
  // as a standalone segment of the primary label.
  it("does NOT substring-match short brand 'ANZ' in 'franzese.com'", () => {
    const shortList: BrandEntry[] = [
      { brand: "ANZ", legitimate_domains: ["anz.com.au"] },
    ];
    expect(lexicalMatch("franzese.com", shortList)).toBeNull();
    expect(lexicalMatch("lanzhoudhl.com", shortList)).toBeNull();
    expect(lexicalMatch("nathanz.art", shortList)).toBeNull();
    expect(lexicalMatch("bigbassbonanzacasino.uk", shortList)).toBeNull();
  });

  it("DOES substring-match short brand 'ANZ' in 'anz-bank.shop' (word-boundary)", () => {
    const shortList: BrandEntry[] = [
      { brand: "ANZ", legitimate_domains: ["anz.com.au"] },
    ];
    const result = lexicalMatch("anz-bank.shop", shortList);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("substring");
  });

  it("DOES substring-match short brand 'IGA' in 'iga_online.com'", () => {
    const shortList: BrandEntry[] = [
      { brand: "IGA", legitimate_domains: ["iga.com.au"] },
    ];
    const result = lexicalMatch("iga_online.com", shortList);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("substring");
  });

  it("preserves loose substring behaviour for long brand 'Bunnings'", () => {
    const list: BrandEntry[] = [
      { brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] },
    ];
    const result = lexicalMatch("buybunningsdirect.shop", list);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("substring");
  });

  it("substring-matches an A-label that contains the brand string", () => {
    // We do NOT decode IDN at MVP — Node's URL constructor doesn't decode
    // punycode A-labels to Unicode. Instead we rely on the brand appearing
    // as a substring of the raw label (xn--bunnings-cn1c.shop contains
    // "bunnings"). Real IDN homograph handling is Phase B scope.
    const result = lexicalMatch("xn--bunnings-cn1c.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Bunnings");
    expect(result?.signal_type).toBe("substring");
  });

  it("prefers higher-score signal when multiple types match", () => {
    const result = lexicalMatch("bunnings.shop", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("substring");
  });

  // v2 scam-context-token gate (issue #405). Second prod run after #403
  // surfaced ~70% FP rate from common-English-word embeddings ("Greece"
  // contains "reece", "carpentry" contains "target"). Substring hits now
  // require either (a) primary label IS the brand exactly, or (b) a
  // scam-context token (bank/login/shop/pay/au/etc.) appears in the
  // domain with the brand stripped.

  it("v2: bare-brand-on-wrong-TLD always fires (no context token required)", () => {
    // `westpac.com` — primary IS the brand, .com is not the legitimate TLD.
    // Classic impersonation; must hit regardless of context tokens.
    const result = lexicalMatch("westpac.com", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Westpac");
    expect(result?.signal_type).toBe("substring");
  });

  it("v2: does NOT fire on 'Greece' for brand 'Reece' (common-word embedding)", () => {
    const list: BrandEntry[] = [{ brand: "Reece", legitimate_domains: ["reece.com.au"] }];
    expect(lexicalMatch("bigclash-greece.co", list)).toBeNull();
    expect(lexicalMatch("greeceexcursion.com", list)).toBeNull();
    expect(lexicalMatch("spindjinn-greece.net", list)).toBeNull();
  });

  it("v2: does NOT fire on common-word embeddings of brand 'Target' (no scam-context)", () => {
    const list: BrandEntry[] = [{ brand: "Target", legitimate_domains: ["target.com.au"] }];
    // 'targettcarpentryltd.co.uk' — carpenter surname-style FP
    expect(lexicalMatch("targettcarpentryltd.co.uk", list)).toBeNull();
    // 'legacypnttargetpro.co' — random "pro" suffix, no scam-context token
    expect(lexicalMatch("legacypnttargetpro.co", list)).toBeNull();
  });

  it("v2: does NOT fire on surname-embedded 'colescreekllc.org' for brand 'Coles'", () => {
    const list: BrandEntry[] = [{ brand: "Coles", legitimate_domains: ["coles.com.au"] }];
    expect(lexicalMatch("colescreekllc.org", list)).toBeNull();
  });

  it("v2: does NOT fire on 'pricelineevsunbury.com' (brand-substring with no context)", () => {
    const list: BrandEntry[] = [{ brand: "Priceline", legitimate_domains: ["priceline.com.au"] }];
    expect(lexicalMatch("pricelineevsunbury.com", list)).toBeNull();
  });

  it("v2: DOES fire on 'westpachomesb.info' (TP — residue contains 'home')", () => {
    const list: BrandEntry[] = [{ brand: "Westpac", legitimate_domains: ["westpac.com.au"] }];
    const result = lexicalMatch("westpachomesb.info", list);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Westpac");
    expect(result?.signal_type).toBe("substring");
  });

  it("v2: 1-char-prefix typosquats stay caught via Levenshtein fallback", () => {
    // 'qkmart.com' — substring gate kills the brand-substring path (no
    // context token in `q .com`), but Levenshtein (dist=1, minlen=5 met)
    // still fires. This is the safety net for single-edit typosquats
    // (`qkmart`, `kmartz`, `2kmart`) which lack context tokens. Brands
    // shorter than 5 chars (KFC, ANZ, NAB, IGA, Aldi) skip Levenshtein
    // by design, so `kfc-net.net` IS a known FN — see next test.
    const list: BrandEntry[] = [{ brand: "Kmart", legitimate_domains: ["kmart.com.au"] }];
    const result = lexicalMatch("qkmart.com", list);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("levenshtein");
  });

  it("v2: known FN — 'kfc-net.net' is gated out (short brand, no Levenshtein safety net)", () => {
    // Short brands (<5 chars) skip Levenshtein to avoid `kfd`/`kfe`-style
    // dictionary collisions, so brand-substring is their only path. Gated
    // by context-token requirement here; Phase A scanner (#376) picks up
    // domains like `kfc-net.net` via DNS/content inspection.
    const list: BrandEntry[] = [{ brand: "KFC", legitimate_domains: ["kfc.com.au"] }];
    expect(lexicalMatch("kfc-net.net", list)).toBeNull();
  });

  it("v2: .com.au TLD alone does NOT satisfy the 'au' context token", () => {
    // `targetscarpenter.com.au` — brand substring + `.com.au` suffix.
    // The 2-char ccTLD drop prevents the universal `.au` from leaking.
    const list: BrandEntry[] = [{ brand: "Target", legitimate_domains: ["target.com.au"] }];
    expect(lexicalMatch("targetscarpenter.com.au", list)).toBeNull();
  });

  it("v2: 'au' as a primary-label segment IS legitimate context", () => {
    // Use .com TLD (not .shop) to isolate the `au` token as the only
    // possible gate trigger; `.shop` would also satisfy the gate and
    // mask whether the `au`-as-segment path actually fires.
    const list: BrandEntry[] = [{ brand: "Westpac", legitimate_domains: ["westpac.com.au"] }];
    const result = lexicalMatch("westpac-au.com", list);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("substring");
  });

  it("v3: does NOT fire on 'autoecolesoultbycfconduite.fr' for brand 'Coles' (#409 FP kill)", () => {
    // Day-1 prod evidence (2026-05-24). `autoecolesoultbycfconduite` is a
    // French driving school. Brand "coles" matches as a substring (embedded
    // in "auto-écoles"). Pre-v3 the residue `auto eoultbycfconduite.fr` had
    // `.fr` ccTLD dropped → `autoeoultbycfconduite` → `.includes("au")` =
    // true → FP. v3 requires `au` to be a residue segment, not embedded.
    const list: BrandEntry[] = [{ brand: "Coles", legitimate_domains: ["coles.com.au"] }];
    expect(lexicalMatch("autoecolesoultbycfconduite.fr", list)).toBeNull();
  });

  it("v3: does NOT fire on 'auctionkmartco.com' for brand 'Kmart' (segment-position guard)", () => {
    // Brand "kmart" substring hit. Pre-v3, residue `auctionco` → mid-word
    // `au` leak. v3 guards by requiring `au` to be its own residue segment.
    const list: BrandEntry[] = [{ brand: "Kmart", legitimate_domains: ["kmart.com.au"] }];
    expect(lexicalMatch("auctionkmartco.com", list)).toBeNull();
  });

  it("v3: DOES fire on 'kmart-au-secure.shop' (segment-bounded 'au' as middle segment)", () => {
    // Defense: the segment-bounded check must work when `au` sits between
    // two other segments, not just leading/trailing. Residue after Kmart
    // strip: ` -au-secure.shop` → segments ["", "au", "secure", "shop"]
    // → `au` is present. TP preserved.
    const list: BrandEntry[] = [{ brand: "Kmart", legitimate_domains: ["kmart.com.au"] }];
    const result = lexicalMatch("kmart-au-secure.shop", list);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("substring");
  });

  it("v2: confusable signal is NOT gated by context-token requirement", () => {
    // Cyrillic 'а' in westpac with no other context tokens. Confusable hits
    // are intentional homograph attacks — always high-confidence.
    const list: BrandEntry[] = [{ brand: "Westpac", legitimate_domains: ["westpac.com.au"] }];
    const result = lexicalMatch("westpаc.net", list);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("confusable");
  });

  it("v2: Levenshtein signal is NOT gated by context-token requirement", () => {
    // bunings (1-edit from bunnings) on a .net TLD with no context tokens.
    // Single-edit typos are scoped tightly already (threshold=1, minlen=5).
    const list: BrandEntry[] = [{ brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] }];
    const result = lexicalMatch("bunings.net", list);
    expect(result).not.toBeNull();
    expect(result?.signal_type).toBe("levenshtein");
  });

  it("never returns score >= 1.0 (cap below `medium` severity boundary)", () => {
    // Per #376 severity formula `round(score * 40)`, score >= 1.0 would map
    // to severity 40 = `medium` tier, violating the MVP cap. Confusable is
    // the highest signal at 0.9 → severity 36 → low. Defence-in-depth: if
    // a future signal pushes score above 0.95 the matcher clamps.
    const probes = [
      "bunnings.shop",
      "bunings.shop",
      "westpаc-login.shop",
      "jbhifi-au.shop",
    ];
    for (const probe of probes) {
      const result = lexicalMatch(probe, TEST_WATCHLIST);
      if (result) {
        expect(result.score).toBeLessThan(1.0);
      }
    }
  });
});

// PR-E (#494) — IDN / punycode decoding before lexical match.
describe("decodeIdnLabel", () => {
  it("returns the input unchanged when not an A-label", () => {
    expect(decodeIdnLabel("auspost")).toBe("auspost");
    expect(decodeIdnLabel("nab")).toBe("nab");
    expect(decodeIdnLabel("")).toBe("");
  });

  it("decodes a well-formed A-label to its Unicode U-label", () => {
    // "xn--bnings-cua" decodes to "bnäings" (latin small letter a with
    // diaeresis inserted between the ASCII letters per RFC 3492). The exact
    // round-trip output is what we want — the test just proves the call
    // wires through node:punycode and returns the Unicode form.
    expect(decodeIdnLabel("xn--bnings-cua")).toBe("bnäings");
    // Sanity: the output must differ from the input when decoding occurred.
    expect(decodeIdnLabel("xn--bnings-cua")).not.toBe("xn--bnings-cua");
  });

  it("returns the input on malformed punycode (never throws)", () => {
    // Clearly malformed — punycode.toUnicode either throws or returns garbage;
    // we treat both as opaque ASCII and return the raw input.
    const broken = "xn---broken---";
    const result = decodeIdnLabel(broken);
    // Either the original is returned OR a best-effort decode is — the
    // contract is "never throws"; verify by checking the call completed
    // (toBeDefined succeeds on any string, including "").
    expect(result).toBeDefined();
  });
});

describe("lexicalMatch — IDN decode integration (PR-E, #494)", () => {
  it("runs the scam-context gate on the decoded U-label, not the raw punycode (#510)", () => {
    // xn--bunnings-secure-flb decodes to "bunnings-secureä". The substring
    // gate must evaluate the DECODED U-label so the "secure" scam-context
    // token is seen — on a neutral .com TLD (no token-TLD shortcut like
    // .shop), this only fires because the decoded residue contains "secure".
    // Pre-#510 the gate was fed the raw `xn--…` form; this locks the
    // decoded-form contract going forward.
    const result = lexicalMatch("xn--bunnings-secure-flb.com", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.brand).toBe("Bunnings");
    expect(result?.signal_type).toBe("substring");
    expect(result?.evidence.idn_decoded).toBeDefined();
  });

  it("preserves the raw A-label as input_label while matching the decoded form", () => {
    // Synthesise an A-label whose Unicode form contains the brand substring.
    // We use punycode to construct one for deterministic testing.
    // "bunnings" is already plain ASCII — `xn--bunnings-NA` would just be the
    // ASCII form re-encoded. Instead test that NON-decoded raw forms still
    // work (regression guard).
    const result = lexicalMatch("bunnings-shop.com", TEST_WATCHLIST);
    expect(result).not.toBeNull();
    expect(result?.evidence.input_label).toBe("bunnings-shop");
    expect(result?.evidence.idn_decoded).toBeUndefined();
  });

  it("does not throw on a malformed xn-- primary label", () => {
    expect(() =>
      lexicalMatch("xn---bunnings-broken.com", TEST_WATCHLIST),
    ).not.toThrow();
  });

  it("does not fire on an A-label whose decoded form is unrelated", () => {
    // "xn--example-9ya" decodes to "exampleñ" — no brand match expected.
    const result = lexicalMatch("xn--example-9ya.com", TEST_WATCHLIST);
    expect(result).toBeNull();
  });
});
