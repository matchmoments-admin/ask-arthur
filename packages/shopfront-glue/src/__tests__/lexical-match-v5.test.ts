// Matcher v5 (#1150) — short-brand recall without the word class.
//
// Every guard below was run RED before it was trusted (2026-09-27), because
// this Module's history is guards that passed while asserting nothing (the
// "does not flood on EY" test never reached the branch it named):
//
//   G1 nine threats      — deleted `openShortNeighbourhood` from Apple/Bonds/
//                          Coles AND the homoglyph return → 9/9 red.
//   G2 word floor        — commented out the SHORT_BRAND_NEIGHBOUR_WORDS check
//                          in shortBrandRecovery → bonus/bands/gonds/apply/
//                          bondi/cowes red (the open brands re-admit them).
//   G3 homoglyph path    — removed "o>0" and "e>3" from HOMOGLYPH_SUBSTITUTIONS
//                          → b0nds/k0gan/sh3in red; closed-brand non-words
//                          stayed green (they must — they are the negative half).
//   G4 v4 untouched      — made `recovery` fire even when shortBrandTrusted →
//                          xbonds.net / b0nds.shop carried `short_brand_gate`,
//                          red. (The first fixture, qkmart.com, stayed GREEN
//                          under that mutation — Kmart is closed, so recovery
//                          returned null anyway. Replaced.)
//   G5 covered tokens    — added a fake 5-char brand "Zzzzz" to a copy of the
//                          watchlist passed to the guard → red.
//   G6 flag can act      — set openShortNeighbourhood on a ≥6-char brand in a
//                          fixture → red.
//   G7 version           — reverted LEXICAL_MATCHER_VERSION to "v4" → red.
//   G8 label key         — made candidateLabelKey skip the confusable fold →
//                          the Cyrillic case red.
import { describe, expect, it } from "vitest";
import { AU_BRAND_WATCHLIST, type BrandEntry } from "../au-brand-watchlist";
import {
  LEXICAL_MATCHER_VERSION,
  candidateLabelKey,
  lexicalMatch,
} from "../lexical-match";
import { NEIGHBOUR_WORDS_COVERED_TOKENS } from "../short-brand-neighbour-words";

const fiveCharTokens = (list: readonly BrandEntry[]) =>
  list.flatMap((e) =>
    [e.brand, ...(e.aliases ?? [])]
      .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length === 5)
      .map((token) => ({ entry: e, token })),
  );

describe("G1 — the nine confirmed threats v4 missed are matched", () => {
  // Every one is weaponised, likely_phishing, or taken down in prod.
  const cases: Array<[string, string]> = [
    ["woles.net", "Coles"],
    ["appve.vu", "Apple"],
    ["bonos.buzz", "Bonds"],
    ["bnds.cl", "Bonds"],
    ["appie.bond", "Apple"],
    ["appie.beer", "Apple"],
    ["appie.autos", "Apple"],
    ["appie.mom", "Apple"],
    ["appie.beauty", "Apple"],
  ];
  it.each(cases)("%s → %s", (domain, brand) => {
    const m = lexicalMatch(domain);
    expect(m?.brand).toBe(brand);
    expect(m?.signal_type).toBe("levenshtein");
    expect(m?.evidence.short_brand_gate).toBeDefined();
  });
});

describe("G2 — the precision failures stay dead, including on open brands", () => {
  // Neutral TLDs on purpose. `.shop` / `.store` / `.online` carry a scam-context
  // token, which v4 already trusts OUTSIDE the primary label — `gonds.online`
  // matches in v4 and v5 alike, and is #1084's bulk-registration fold's job.
  it.each([
    // bonds (OPEN) — the word class, and the #1084 bulk label
    "bonus.business", "bands.io", "bounds.io", "bones.club", "binds.co",
    "ponds.net", "gonds.quest", "gonds.co", "bondi.ink",
    // apple (OPEN)
    "apply.wiki", "ample.io",
    // coles (OPEN)
    "codes.net", "holes.net", "roles.world", "cowes.yachts",
    // closed brands — word neighbours
    "mart.services", "bank.camera", "stage.tours", "snake.io",
    "logan.net", "hogan.io",
  ])("%s does not match", (domain) => {
    expect(lexicalMatch(domain)).toBeNull();
  });

  it("closed 5-char brands still gate non-word neighbours (no homoglyph)", () => {
    for (const d of ["dmart.app", "medex.care", "xbank.one", "vinet.dev", "festa.social", "nesta.top", "stakz.xyz"]) {
      expect(lexicalMatch(d), d).toBeNull();
    }
  });
});

describe("G3 — homoglyph substitution is recovered for every 5-char brand", () => {
  it.each([
    ["b0nds.com", "Bonds"],
    ["c0les.net", "Coles"],
    ["sh3in.co", "Shein"],
    ["k0gan.xyz", "Kogan"],
  ])("%s → %s via homoglyph", (domain, brand) => {
    const m = lexicalMatch(domain);
    expect(m?.brand).toBe(brand);
    expect(m?.evidence.short_brand_gate).toBe("homoglyph");
  });

  it("a transposition is two edits and stays out of reach (kmrat)", () => {
    expect(lexicalMatch("kmrat.com")).toBeNull();
  });
});

describe("G4 — v4 matches are untouched", () => {
  // On an OPEN brand, and on a homoglyph, so the recovery WOULD fire if it
  // were consulted — a closed-brand fixture (qkmart) passed the red run.
  it.each([
    ["xbonds.net", "Bonds"], // insertion keeps the brand contiguous
    ["b0nds.shop", "Bonds"], // context token outside the primary label
  ])("%s is a v4 match and carries no v5 gate", (domain, brand) => {
    const m = lexicalMatch(domain);
    expect(m?.brand).toBe(brand);
    expect(m?.evidence.short_brand_gate).toBeUndefined();
  });
});

describe("G5/G6 — the denylist covers every token the recovery can reach", () => {
  // Pure over its input so the red run could pass a doctored list.
  const uncovered = (list: readonly BrandEntry[]) =>
    fiveCharTokens(list)
      .map((t) => t.token)
      .filter((t) => !NEIGHBOUR_WORDS_COVERED_TOKENS.includes(t));

  it("every 5-char watchlist token was in the generator run", () => {
    // Red: re-run scripts/gen-short-brand-neighbour-words.ts.
    expect(uncovered(AU_BRAND_WATCHLIST)).toEqual([]);
  });

  it("the guard itself goes red on a new uncovered token", () => {
    expect(
      uncovered([...AU_BRAND_WATCHLIST, { brand: "Zzzzz", legitimate_domains: ["zzzzz.com"] }]),
    ).toEqual(["zzzzz"]);
  });

  it("openShortNeighbourhood is only set where a 5-char token exists", () => {
    const decorative = (list: readonly BrandEntry[]) =>
      list
        .filter((e) => e.openShortNeighbourhood)
        .filter((e) => !fiveCharTokens([e]).length)
        .map((e) => e.brand);
    expect(decorative(AU_BRAND_WATCHLIST)).toEqual([]);
    expect(
      decorative([{ brand: "Bunnings", legitimate_domains: [], openShortNeighbourhood: true }]),
    ).toEqual(["Bunnings"]);
  });
});

describe("G7 — the version moved with the behaviour", () => {
  it("is v5", () => {
    expect(LEXICAL_MATCHER_VERSION).toBe("v5");
  });
});

describe("G8 — candidateLabelKey (the #1084 bulk-registration key)", () => {
  it("is the same name across TLDs", () => {
    expect(candidateLabelKey("gonds.co")).toBe("gonds");
    expect(candidateLabelKey("GONDS.online")).toBe("gonds");
  });
  it("decodes IDN and folds confusables like the matcher does", () => {
    expect(candidateLabelKey("xn--auspst-9ya.com")).toBe(candidateLabelKey("xn--auspst-9ya.shop"));
    expect(candidateLabelKey("аpple.com")).toBe("apple"); // Cyrillic а
  });
});
