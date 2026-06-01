import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  brandNormalize,
  parseWatchlist,
  buildAliasRows,
} from "../../scripts/gen-brand-aliases-seed.mjs";
// The runtime (.ts) twin used by app code — must match the build-time (.mjs)
// copy and the SQL brand_normalize() exactly.
import { brandNormalize as brandNormalizeTs } from "../brand-normalize";

const here = path.dirname(fileURLToPath(import.meta.url));
const watchlistTs = readFileSync(
  path.join(here, "..", "au-brand-watchlist.ts"),
  "utf8",
);

describe("brandNormalize (must stay byte-identical to SQL brand_normalize)", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(brandNormalize("NAB")).toBe("nab");
    expect(brandNormalize("National Australia Bank")).toBe("nationalaustraliabank");
    expect(brandNormalize("JB Hi-Fi")).toBe("jbhifi");
    expect(brandNormalize("7-Eleven")).toBe("7eleven");
  });

  it("the runtime (.ts) twin matches the build-time (.mjs) copy on edge cases", () => {
    for (const s of ["NAB", "National Australia Bank", "JB Hi-Fi", "7-Eleven", "", "   ", "-"]) {
      expect(brandNormalizeTs(s)).toBe(brandNormalize(s));
    }
    expect(brandNormalizeTs(null)).toBe(brandNormalize(null));
    expect(brandNormalizeTs(undefined)).toBe(brandNormalize(undefined));
  });

  it("returns null for empty / whitespace-only / symbol-only input", () => {
    expect(brandNormalize("")).toBeNull();
    expect(brandNormalize("   ")).toBeNull();
    expect(brandNormalize("-")).toBeNull();
    expect(brandNormalize(null)).toBeNull();
    expect(brandNormalize(undefined)).toBeNull();
  });
});

describe("brand-alias seed generation over the real watchlist", () => {
  const entries = parseWatchlist(watchlistTs);
  const { rows, collisions } = buildAliasRows(entries);

  it("parses every brand object (including the bank/telco entries with a nested ct block)", () => {
    // The parser must not drop objects that contain `ct: { ... }`.
    expect(entries.length).toBeGreaterThan(200);
    const brands = entries.map((e) => e.brand);
    for (const bank of ["CBA", "NAB", "ANZ", "Westpac"]) {
      expect(brands).toContain(bank);
    }
  });

  it("produces a row for every brand's own normalized name", () => {
    for (const { brand } of entries) {
      const key = brandNormalize(brand);
      if (key === null) continue;
      expect(rows.get(key)).toBe(brand);
    }
  });

  it("resolves known short-form aliases to their canonical brand", () => {
    // commbank is an alias of CBA in the watchlist.
    expect(rows.get("commbank")).toBe("CBA");
    expect(rows.get("nab")).toBe("NAB");
    expect(rows.get("anz")).toBe("ANZ");
  });

  it("the .ts and .mjs normalizers agree on every watchlist brand name", () => {
    for (const { brand } of entries) {
      expect(brandNormalizeTs(brand)).toBe(brandNormalize(brand));
    }
  });

  it("has no normalization collisions (guards future watchlist edits)", () => {
    // A collision means two different canonical brands normalize to the same
    // key — the seed would silently mis-map one. If this fails after a
    // watchlist edit, disambiguate the brand/alias before re-seeding.
    expect(collisions).toEqual([]);
  });
});
