import { describe, it, expect } from "vitest";
import { resolveBrandInWatchlist } from "@/lib/clone-watch/resolve-brand";
import { AU_BRAND_WATCHLIST } from "@askarthur/shopfront-glue";
import type { BrandEntry } from "@askarthur/shopfront-glue/au-brand-watchlist";

/**
 * `resolveWatchlistBrand` is now async (it loads the ACTIVE watchlist —
 * static + verified overlay brands — so a registered customer isn't told its
 * own brand is unmonitored). These assertions are about the MATCHING rule, not
 * about which list is loaded, so they run against the pure
 * `resolveBrandInWatchlist` with an explicit list and touch no database.
 */
const resolve = (input: string, list: readonly BrandEntry[] = AU_BRAND_WATCHLIST) =>
  resolveBrandInWatchlist(input, list);

describe("resolveBrandInWatchlist — closes the cross-brand leak", () => {
  it("resolves a known brand by name (case/spacing-insensitive)", () => {
    expect(resolve("Bunnings")?.brand).toBe("Bunnings");
    expect(resolve("bunnings")?.brand).toBe("Bunnings");
  });

  it("resolves a known brand by its legitimate domain (with www / protocol)", () => {
    expect(resolve("bunnings.com.au")?.brand).toBe("Bunnings");
    expect(resolve("https://www.bunnings.com.au/store")?.brand).toBe("Bunnings");
  });

  it("returns null for SQL LIKE wildcards — the leak that must NOT resolve", () => {
    expect(resolve("%%")).toBeNull();
    expect(resolve("%")).toBeNull();
    expect(resolve("a%")).toBeNull();
    expect(resolve("_")).toBeNull();
    expect(resolve("")).toBeNull();
  });

  it("returns null for a brand we don't monitor (→ unmonitored-lead path)", () => {
    expect(resolve("some-random-brand-xyz")).toBeNull();
    expect(resolve("notreal.com")).toBeNull();
  });

  it("resolves an overlay-registered brand when given the active list", () => {
    // The behaviour change this refactor exists for: a brand present only in
    // the runtime overlay used to resolve to null, so a paying customer was
    // told their own registered brand was unmonitored.
    const withOverlay: BrandEntry[] = [
      ...AU_BRAND_WATCHLIST,
      { brand: "Pilot Brand", legitimate_domains: ["pilotbrand.com.au"], aliases: ["PilotCo"] },
    ];
    expect(resolve("Pilot Brand", withOverlay)?.brand).toBe("Pilot Brand");
    expect(resolve("pilotbrand.com.au", withOverlay)?.brand).toBe("Pilot Brand");
    expect(resolve("PilotCo", withOverlay)?.brand).toBe("Pilot Brand");
    // …and still null against the static list alone.
    expect(resolve("Pilot Brand")).toBeNull();
  });
});
