import { describe, expect, it } from "vitest";
import { isNonBrandLabel, splitBrandLabel } from "../brand-label";
import { buildBrandMultiResolver, buildBrandResolver } from "../brand-resolver";
import type { BrandAliasRecord } from "../brand-resolver";

/**
 * GUARD — a classifier label that WRAPS a brand name in prose must not hide the
 * brand from the "already watched?" gate.
 *
 * THE BUG THIS EXISTS TO PREVENT (found 2026-08-27)
 * ------------------------------------------------
 * The 2026-08-24 digest offered "NAB (National Australia Bank)" as ready to
 * promote. NAB is monitored (au-brand-watchlist.ts, nab.com.au, CT core) and
 * has TWO alias rows — `nab` and `nationalaustraliabank`. Neither matched,
 * because brandNormalize() strips the whole string to
 * `nabnationalaustraliabank`. Exact set membership makes a near-miss look
 * identical to an unknown brand.
 *
 * WHY THIS TEST IS A SIBLING OF watchlist-label-variants.test.ts, NOT A COPY
 * -------------------------------------------------------------------------
 * That test walks all 291 WATCHLIST labels — the side we author. This one walks
 * the CLASSIFIER side, which nobody controls and which had no guard at all.
 * v260 (classifier label longer than the watchlist's) and v261 (watchlist label
 * longer than the classifier's) were both fixed by seeding a brand_aliases row
 * per variant; NAB is the third instance, and the third alias row would not
 * have stopped a fourth.
 *
 * THE FIXTURES ARE REAL
 * ---------------------
 * Every label below is a literal scam_reports.impersonated_brand value captured
 * from prod on 2026-08-27 (44 labelled rows; 23 carry a separator). They assert
 * PROPERTIES — "a watched brand is never proposed", "a hedged label resolves to
 * nothing" — not point-in-time facts, which go stale as the window rolls.
 */

// The live alias shape, trimmed to the rows these cases exercise. Values are
// the real canonical_brand strings from prod brand_aliases.
const ALIASES: BrandAliasRecord = {
  nab: "NAB",
  nationalaustraliabank: "NAB",
  linkt: "Linkt (Transurban)",
  apple: "Apple",
  icloud: "Apple",
  instagram: "Instagram",
  meta: "Meta",
  mygov: "myGov",
  australiapost: "Australia Post",
  // Whole-string rows that ALREADY exist in prod brand_aliases — every one of
  // them seeded retroactively after an earlier leak of this same class. They
  // are here so the test proves the fragment path never displaces them.
  appleincicloud: "Apple",
  instagrammeta: "Instagram",
  mygovaustraliangovernment: "myGov",
  australiantaxofficeato: "Australian Taxation Office",
};

const resolveOne = buildBrandResolver(ALIASES);
const resolveMulti = buildBrandMultiResolver(ALIASES);

describe("splitBrandLabel", () => {
  it("offers the whole string before any fragment", () => {
    // The contract that keeps every existing v260/v261 alias row winning: an
    // exact whole-string match must never be beaten by a fragment.
    expect(splitBrandLabel("NAB (National Australia Bank)")[0]).toBe(
      "NAB (National Australia Bank)",
    );
  });

  it("orders fragments longest-first", () => {
    expect(splitBrandLabel("NAB (National Australia Bank)")).toEqual([
      "NAB (National Australia Bank)",
      "National Australia Bank",
      "NAB",
    ]);
  });

  it("splits on parenthesis, slash, comma and a SPACED hyphen", () => {
    expect(splitBrandLabel("Instagram / Meta")).toContain("Instagram");
    expect(splitBrandLabel("Instagram / Meta")).toContain("Meta");
    expect(splitBrandLabel("Apple Inc. / iCloud")).toContain("iCloud");
  });

  it("does NOT split a bare hyphen — those are single names", () => {
    // "Jetstar-Qantas" split into two brands is how a wrong attribution gets
    // made. Only " - " (spaced) reads as punctuation.
    expect(splitBrandLabel("Jetstar-Qantas")).toEqual(["Jetstar-Qantas"]);
  });

  it("returns [] for empty, whitespace and punctuation-only input", () => {
    for (const raw of [null, undefined, "", "   ", "///", "()"]) {
      expect(splitBrandLabel(raw)).toEqual([]);
    }
  });

  it("drops bare corporate-suffix fragments", () => {
    expect(splitBrandLabel("Apple Inc. / iCloud")).not.toContain("Inc.");
  });
});

describe("isNonBrandLabel — the load-bearing guard", () => {
  // Splitting WITHOUT this gate lifts "iCloud" out of the first label below and
  // resolves it, confidently, to Apple — on a label whose own words say the
  // classifier could not identify the brand.
  const hedged = [
    "Generic cloud storage provider (possibly Google Drive/OneDrive/iCloud)",
    "Generic financial/rewards app (impersonation of legitimate fintech/payment service)",
    "Generic health insurance provider (OFHC or similar)",
    "Designer goods retailers (generic impersonation)",
    "Coastal Rescue Foundation (potentially)",
    "Australian Bushfire Relief Foundation (unverified)",
  ];

  it.each(hedged)("flags %s", (label) => {
    expect(isNonBrandLabel(label)).toBe(true);
    expect(splitBrandLabel(label)).toEqual([]);
    expect(resolveMulti(label)).toEqual([]);
  });

  it("does NOT treat the word 'impersonating' as a hedge", () => {
    // These were markers in the first cut and were removed after measuring:
    // across all 35 distinct prod labels they caught ZERO that the structural
    // markers did not already catch, while silently discarding a whole class
    // that names a brand perfectly well. The field is literally called
    // `impersonated_brand` — describing the ACTION is its subject, not a hedge.
    // A hedge hit drops the label before the upsert AND is excluded from
    // findLeakSuspects, so the loss would leave no count and no sample.
    expect(isNonBrandLabel("Scammer impersonating Telstra support")).toBe(false);
    expect(isNonBrandLabel("Impersonation of Australia Post")).toBe(false);
    // SURVIVES as a candidate — which is the whole point. It is not RECOGNISED
    // as Australia Post, and that is an honest boundary of this Module rather
    // than a gap it papers over: splitting is separator-driven, and prose with
    // no punctuation has nothing to split on. Such a label lands unresolved and
    // COMPOUND-negative, so it reaches the operator as a candidate instead of
    // being silently discarded. Widening to word-window matching would trade
    // this recall for the false-attribution risk the hedge gate exists to stop.
    expect(splitBrandLabel("Impersonation of Australia Post")).toEqual([
      "Impersonation of Australia Post",
    ]);
    // …while the structural markers still catch the two real prod labels that
    // happen to also contain the word.
    expect(isNonBrandLabel("Designer goods retailers (generic impersonation)")).toBe(true);
    // And the separator-bearing form DOES resolve, which is this PR's scope.
    expect(resolveMulti("Australia Post (AusPost)")).toEqual(["Australia Post"]);
  });

  it("does not trip on a brand that merely contains a hedge substring", () => {
    // "genuine" must not match "generic"; word boundaries, not substrings.
    expect(isNonBrandLabel("Genuine Parts Company")).toBe(false);
    expect(isNonBrandLabel("NAB (National Australia Bank)")).toBe(false);
  });
});

describe("buildBrandMultiResolver — real prod labels", () => {
  it("resolves the NAB leak that prompted this module", () => {
    // The whole-string form resolves to nothing; the fragment carries it.
    expect(resolveOne("NAB (National Australia Bank)")).toBeNull();
    expect(resolveMulti("NAB (National Australia Bank)")).toEqual(["NAB"]);
  });

  it("resolves BOTH Linkt variants to the same canonical", () => {
    // Two distinct strings, one report each — neither reaches the >=2 bar, and
    // both are already watched. The gate must see through both phrasings.
    expect(
      resolveMulti("Linkt / Transurban (generic toll operator impersonation)"),
    ).toEqual([]); // hedged: "generic" + "impersonation" — correctly withheld
    expect(resolveMulti("Linkt / Transurban (toll operators)")).toEqual([
      "Linkt (Transurban)",
    ]);
  });

  it("keeps every whole-string alias row winning (v260/v261 regression)", () => {
    // These already resolved before this change and must be unaffected.
    for (const [label, expected] of [
      ["Australian Tax Office (ATO)", "Australian Taxation Office"],
      ["myGov (Australian Government)", "myGov"],
      ["Australia Post", "Australia Post"],
    ] as const) {
      expect(resolveMulti(label)[0]).toBe(expected);
      expect(resolveOne(label)).toBe(expected);
    }
  });

  it("returns every distinct canonical when a label names two brands", () => {
    expect(resolveMulti("Instagram / Meta")).toEqual(["Instagram", "Meta"]);
  });

  it("returns [] rather than guessing on an unknown brand", () => {
    expect(resolveMulti("School / Australia Cancer Relief Fund")).toEqual([]);
    expect(resolveMulti("BFirstApparel")).toEqual([]);
  });

  it("leaves buildBrandResolver's single-answer contract untouched", () => {
    // The precision path (stewardship email routing, brand-register counts)
    // must behave exactly as before — no fragment fallback.
    expect(resolveOne("Linkt / Transurban (toll operators)")).toBeNull();
    expect(resolveOne("nab")).toBe("NAB");
    expect(resolveOne("")).toBeNull();
  });
});
