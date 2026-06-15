import { describe, expect, it } from "vitest";

import { FP_BRAND_DENYLIST, isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";

describe("isFpBrand", () => {
  it("flags the generic-dictionary FP brands", () => {
    expect(isFpBrand("domain.com.au")).toBe(true);
    expect(isFpBrand("lendi.com.au")).toBe(true);
    expect(isFpBrand("allhomes.com.au")).toBe(true);
  });

  it("is case-insensitive and trims", () => {
    expect(isFpBrand("  Lendi.com.au ")).toBe(true);
    expect(isFpBrand("DOMAIN.COM.AU")).toBe(true);
  });

  it("does not flag real brands", () => {
    expect(isFpBrand("anz.com.au")).toBe(false);
    expect(isFpBrand("paypal.com")).toBe(false);
    expect(isFpBrand("iinet.net.au")).toBe(false);
  });

  it("handles null/undefined/empty safely", () => {
    expect(isFpBrand(null)).toBe(false);
    expect(isFpBrand(undefined)).toBe(false);
    expect(isFpBrand("")).toBe(false);
  });

  it("exposes the canonical set", () => {
    expect(FP_BRAND_DENYLIST.has("domain.com.au")).toBe(true);
    expect(FP_BRAND_DENYLIST.size).toBe(3);
  });
});
