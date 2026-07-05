import { describe, it, expect } from "vitest";
import { resolveWatchlistBrand } from "@/lib/clone-watch/resolve-brand";

describe("resolveWatchlistBrand — closes the cross-brand leak", () => {
  it("resolves a known brand by name (case/spacing-insensitive)", () => {
    expect(resolveWatchlistBrand("Bunnings")?.brand).toBe("Bunnings");
    expect(resolveWatchlistBrand("bunnings")?.brand).toBe("Bunnings");
  });

  it("resolves a known brand by its legitimate domain (with www / protocol)", () => {
    expect(resolveWatchlistBrand("bunnings.com.au")?.brand).toBe("Bunnings");
    expect(resolveWatchlistBrand("https://www.bunnings.com.au/store")?.brand).toBe("Bunnings");
  });

  it("returns null for SQL LIKE wildcards — the leak that must NOT resolve", () => {
    expect(resolveWatchlistBrand("%%")).toBeNull();
    expect(resolveWatchlistBrand("%")).toBeNull();
    expect(resolveWatchlistBrand("a%")).toBeNull();
    expect(resolveWatchlistBrand("_")).toBeNull();
    expect(resolveWatchlistBrand("")).toBeNull();
  });

  it("returns null for a brand we don't monitor (→ unmonitored-lead path)", () => {
    expect(resolveWatchlistBrand("some-random-brand-xyz")).toBeNull();
    expect(resolveWatchlistBrand("notreal.com")).toBeNull();
  });
});
