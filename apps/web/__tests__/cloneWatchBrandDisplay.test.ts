import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SUPER_FUND_DOMAINS,
  prettyBrand,
  superFundsMissingDisplayName,
} from "@/lib/clone-watch/brand-display";

/**
 * Every brand name the monthly post publishes goes through `prettyBrand`, and
 * its fallback is capitalise-first — which is silently wrong for exactly the
 * brands that need an override, and only on the month one of them leads.
 *
 * Australian Retirement Trust and Brighter Super were in the fund set with no
 * override, so the first month either led the spotlight would have published
 * "Australianretirementtrust" and "Brightersuper" — on the slide AND in the
 * caption, since both call prettyBrand. Nothing failed; there was simply no
 * month where it showed.
 */
describe("super-fund display names", () => {
  it("every fund has a casing override — capitalise-first is never acceptable here", () => {
    expect(superFundsMissingDisplayName()).toEqual([]);
  });

  it("the two that were missing now read as their real names", () => {
    expect(prettyBrand("australianretirementtrust.com.au")).toBe(
      "Australian Retirement Trust",
    );
    expect(prettyBrand("brightersuper.com.au")).toBe("Brighter Super");
  });

  it("keeps the fund set and the casing map in ONE file", () => {
    // The lists drifted while they lived in two files. Adjacency is the actual
    // guard — this test just makes the move deliberate to undo.
    const src = readFileSync(
      new URL("../lib/clone-watch/brand-display.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/export const SUPER_FUND_DOMAINS/);
    expect(SUPER_FUND_DOMAINS.size).toBeGreaterThanOrEqual(14);
  });
});
