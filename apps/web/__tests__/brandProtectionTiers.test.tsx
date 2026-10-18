import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BrandProtectionTiers, {
  BRAND_PROMISE_LINES,
  PUBLIC_BRAND_PLANS,
} from "@/components/BrandProtectionTiers";
import { ENTITLEMENT_PROMISES } from "@/lib/clone-watch/brand-subscriber";

// #1295 (founder, 2026-10-13): hide the self-serve tiers, sell only the manual
// A$300 pilot, and promise only what the entitlement Module enforces.
//
// Go-red (2026-10-13): against the pre-#1295 component + BRAND_PLANS every
// case below FAILED — it rendered A$1,950 / A$2,950 / Enterprise cards, "5
// managed takedowns / mo" (nothing caps or counts per month) and an "Evidence
// dashboard" (the brand page does not exist until #1302).
const html = renderToStaticMarkup(<BrandProtectionTiers />);

describe("BrandProtectionTiers", () => {
  it("shows only the pilot, at A$300", () => {
    expect(PUBLIC_BRAND_PLANS.map((p) => p.key)).toEqual(["brand_pilot"]);
    expect(html).toContain("A$300");
    for (const hidden of [
      "A$1,950",
      "A$2,950",
      "Brand Monitor+",
      "Enterprise",
    ]) {
      expect(html).not.toContain(hidden);
    }
  });

  it("promises exactly the enforced entitlements — one line each, nothing else", () => {
    const expected = Object.values(ENTITLEMENT_PROMISES).filter(
      (l) => l !== null,
    );
    expect([...BRAND_PROMISE_LINES].sort()).toEqual([...expected].sort());
    for (const line of BRAND_PROMISE_LINES) {
      // renderToStaticMarkup escapes the apostrophe.
      expect(html).toContain(line.replace(/'/g, "&#x27;"));
    }
  });

  it("never promises a takedown allotment or a dashboard that does not exist yet", () => {
    expect(html).not.toMatch(/takedowns \/ mo/i);
    expect(html).not.toMatch(/unlimited/i);
    expect(html).not.toMatch(/dashboard/i);
  });
});
