import { describe, expect, it } from "vitest";
import {
  buildWatchedKeySet,
  mergeDynamicWatchlist,
  resolveBrandInWatchlist,
} from "../active-watchlist";
import type { BrandEntry } from "../au-brand-watchlist";

const STATIC: BrandEntry[] = [
  { brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] },
  {
    brand: "Commonwealth Bank",
    legitimate_domains: ["commbank.com.au"],
    aliases: ["CommBank", "CBA"],
  },
];

describe("mergeDynamicWatchlist — the empty-domains guard", () => {
  it("REJECTS an overlay brand with no legitimate domains", () => {
    // legitimate_domains is the matcher's EXCLUSION list. A brand merged with
    // an empty one matches its own website and reports it as a clone of
    // itself. monitored_brands defaults the column to '{}' and the original
    // private merge did `?? []`, so this was reachable in production.
    const r = mergeDynamicWatchlist([{ brand: "Ghost", legitimate_domains: [] }], STATIC);
    expect(r.entries.map((e) => e.brand)).toEqual(["Bunnings", "Commonwealth Bank"]);
    expect(r.rejected).toEqual([{ brand: "Ghost", reason: "no_domains" }]);
    expect(r.dynamicCount).toBe(0);
  });

  it("rejects null / undefined / whitespace-only domain lists too", () => {
    const r = mergeDynamicWatchlist(
      [
        { brand: "NullDomains", legitimate_domains: null },
        { brand: "NoField" },
        { brand: "Blank", legitimate_domains: ["", "   "] },
      ],
      STATIC,
    );
    expect(r.dynamicCount).toBe(0);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "no_domains",
      "no_domains",
      "no_domains",
    ]);
  });

  it("keeps a brand that has at least one usable domain", () => {
    const r = mergeDynamicWatchlist(
      [{ brand: "Pilot Co", legitimate_domains: ["", "  PilotCo.com.AU/path  "] }],
      STATIC,
    );
    expect(r.dynamicCount).toBe(1);
    expect(r.entries.at(-1)).toEqual({
      brand: "Pilot Co",
      // normalised: lowercased, path stripped, trimmed
      legitimate_domains: ["pilotco.com.au"],
      aliases: [],
    });
  });

  it("strips scheme and www when normalising overlay domains", () => {
    const r = mergeDynamicWatchlist(
      [{ brand: "Scheme Co", legitimate_domains: ["https://www.schemeco.com.au/"] }],
      STATIC,
    );
    expect(r.entries.at(-1)?.legitimate_domains).toEqual(["schemeco.com.au"]);
  });
});

describe("mergeDynamicWatchlist — precedence and dedup", () => {
  it("lets the curated static list win over an overlay row for the same brand", () => {
    const r = mergeDynamicWatchlist(
      [{ brand: "bunnings", legitimate_domains: ["evil-not-bunnings.example"] }],
      STATIC,
    );
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].legitimate_domains).toEqual(["bunnings.com.au"]);
    expect(r.rejected).toEqual([{ brand: "bunnings", reason: "duplicate" }]);
  });

  it("collapses duplicates within the overlay itself to the first row", () => {
    const r = mergeDynamicWatchlist(
      [
        { brand: "Dupe Co", legitimate_domains: ["first.com.au"] },
        { brand: "dupeco", legitimate_domains: ["second.com.au"] },
      ],
      STATIC,
    );
    expect(r.dynamicCount).toBe(1);
    expect(r.entries.at(-1)?.legitimate_domains).toEqual(["first.com.au"]);
    expect(r.rejected).toEqual([{ brand: "dupeco", reason: "duplicate" }]);
  });

  it("rejects a brand name that normalises to nothing", () => {
    const r = mergeDynamicWatchlist(
      [{ brand: "!!!", legitimate_domains: ["symbols.com.au"] }],
      STATIC,
    );
    expect(r.dynamicCount).toBe(0);
    expect(r.rejected).toEqual([{ brand: "!!!", reason: "unnormalisable" }]);
  });

  it("returns the static list untouched for an empty overlay", () => {
    const r = mergeDynamicWatchlist([], STATIC);
    expect(r.entries).toEqual(STATIC);
    expect(r.rejected).toEqual([]);
    expect(r.dynamicCount).toBe(0);
  });

  it("never mutates the static list it was given", () => {
    const before = JSON.parse(JSON.stringify(STATIC));
    mergeDynamicWatchlist([{ brand: "New Co", legitimate_domains: ["newco.com.au"] }], STATIC);
    expect(STATIC).toEqual(before);
  });
});

describe("buildWatchedKeySet — the already-watched predicate", () => {
  it("includes canonical brand names AND aliases, normalized", () => {
    const set = buildWatchedKeySet(STATIC);
    expect(set.has("bunnings")).toBe(true);
    expect(set.has("commonwealthbank")).toBe(true);
    expect(set.has("commbank")).toBe(true);
    expect(set.has("cba")).toBe(true);
    expect(set.has("anz")).toBe(false);
  });

  it("covers an overlay-promoted brand once fed the MERGED list", () => {
    // The re-announce loop in one assertion: promotion writes to the overlay,
    // so a gate fed only the static list never sees the promoted brand and
    // re-surfaces it as a new candidate on every run, forever.
    const promoted = [{ brand: "Promoted Co", legitimate_domains: ["promotedco.com.au"] }];
    expect(buildWatchedKeySet(STATIC).has("promotedco")).toBe(false);

    const merged = mergeDynamicWatchlist(promoted, STATIC);
    expect(buildWatchedKeySet(merged.entries).has("promotedco")).toBe(true);
  });

  it("does NOT mark a rejected overlay brand as watched", () => {
    // A brand rejected for having no domains is genuinely not monitored, so it
    // must stay visible to discovery rather than being silently swallowed.
    const merged = mergeDynamicWatchlist([{ brand: "Ghost", legitimate_domains: [] }], STATIC);
    expect(buildWatchedKeySet(merged.entries).has("ghost")).toBe(false);
  });
});

describe("resolveBrandInWatchlist", () => {
  it("matches by name, alias, or legitimate domain — exactly", () => {
    expect(resolveBrandInWatchlist("CBA", STATIC)?.brand).toBe("Commonwealth Bank");
    expect(resolveBrandInWatchlist("commbank.com.au", STATIC)?.brand).toBe(
      "Commonwealth Bank",
    );
    expect(resolveBrandInWatchlist("https://www.bunnings.com.au/x", STATIC)?.brand).toBe(
      "Bunnings",
    );
  });

  it("never resolves a SQL wildcard", () => {
    for (const evil of ["%%", "%", "a%", "_", ""]) {
      expect(resolveBrandInWatchlist(evil, STATIC)).toBeNull();
    }
  });
});
