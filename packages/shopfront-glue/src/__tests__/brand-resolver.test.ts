import { describe, expect, it } from "vitest";
import { buildBrandResolver, type BrandAliasRecord } from "../brand-resolver";

// alias_normalized (= brandNormalize(raw)) → canonical_brand, as loaded from
// the v174 brand_aliases table.
const ALIASES: BrandAliasRecord = {
  nab: "NAB",
  nationalaustraliabank: "NAB",
  commonwealthbank: "Commonwealth Bank",
  commbank: "Commonwealth Bank",
  "7eleven": "7-Eleven",
};

describe("buildBrandResolver", () => {
  const resolve = buildBrandResolver(ALIASES);

  it("resolves casing/spacing/punctuation variants to one canonical brand", () => {
    expect(resolve("nab")).toBe("NAB");
    expect(resolve("NAB")).toBe("NAB");
    expect(resolve("  N.A.B.  ")).toBe("NAB");
    expect(resolve("National Australia Bank")).toBe("NAB");
    expect(resolve("CommBank")).toBe("Commonwealth Bank");
    expect(resolve("7-Eleven")).toBe("7-Eleven");
  });

  it("returns null for brands not in the alias layer", () => {
    expect(resolve("Woolworths")).toBeNull();
    expect(resolve("some random shop")).toBeNull();
  });

  it("returns null for empty / whitespace / symbol-only / nullish input", () => {
    expect(resolve("")).toBeNull();
    expect(resolve("   ")).toBeNull();
    expect(resolve("!!!")).toBeNull();
    expect(resolve(null)).toBeNull();
    expect(resolve(undefined)).toBeNull();
  });

  it("an empty alias record resolves everything to null (degraded-layer safety)", () => {
    const resolveEmpty = buildBrandResolver({});
    expect(resolveEmpty("NAB")).toBeNull();
  });
});
