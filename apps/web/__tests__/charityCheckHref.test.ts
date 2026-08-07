import { describe, expect, it } from "vitest";
import { buildCharityCheckHref } from "@/lib/charity-check-href";

// v0.2e deep-link builder — the mode=abn case is the regression guard for
// the dead-end bug: CharityChecker reads its tab from ?mode= alone, so an
// ABN-only link without it landed on the Name tab with the prefill
// invisible and submit disabled.
describe("buildCharityCheckHref", () => {
  it("ABN only → forces mode=abn so the ABN tab opens", () => {
    const href = buildCharityCheckHref({ extractedAbn: "11005357522" });
    const url = new URL(href, "https://askarthur.au");
    expect(url.pathname).toBe("/charity-check");
    expect(url.searchParams.get("abn")).toBe("11005357522");
    expect(url.searchParams.get("mode")).toBe("abn");
  });

  it("name only → no mode param (Name tab is the default)", () => {
    const href = buildCharityCheckHref({ extractedName: "Australian Red Cross" });
    const url = new URL(href, "https://askarthur.au");
    expect(url.searchParams.get("name")).toBe("Australian Red Cross");
    expect(url.searchParams.get("mode")).toBeNull();
  });

  it("name + ABN → both params, Name tab default (name field wins the UX)", () => {
    const href = buildCharityCheckHref({
      extractedAbn: "11005357522",
      extractedName: "Australian Red Cross",
    });
    const url = new URL(href, "https://askarthur.au");
    expect(url.searchParams.get("abn")).toBe("11005357522");
    expect(url.searchParams.get("name")).toBe("Australian Red Cross");
    expect(url.searchParams.get("mode")).toBeNull();
  });

  it("neither extracted → bare /charity-check", () => {
    expect(buildCharityCheckHref({})).toBe("/charity-check");
  });
});
