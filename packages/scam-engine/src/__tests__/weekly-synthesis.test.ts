import { describe, it, expect } from "vitest";

import { aggregateWeeklyCohort } from "../reddit-intel/weekly-synthesis";

describe("aggregateWeeklyCohort", () => {
  it("counts categories and brands, sorted desc and capped at 5", () => {
    const cohort = [
      { intent_label: "phishing", brands_impersonated: ["Auspost", "ATO"], tactic_tags: [] },
      { intent_label: "phishing", brands_impersonated: ["Auspost"], tactic_tags: [] },
      { intent_label: "romance_scam", brands_impersonated: [], tactic_tags: [] },
    ];
    const agg = aggregateWeeklyCohort(cohort, []);

    expect(agg.catTotals).toEqual({ phishing: 2, romance_scam: 1 });
    expect(agg.topCategories[0]).toEqual({ label: "phishing", count: 2 });
    expect(agg.topBrands[0]).toEqual({ brand: "Auspost", mentionCount: 2 });
  });

  it("flags brands/tactics absent from the baseline as novel (case-insensitive)", () => {
    const cohort = [
      { intent_label: "phishing", brands_impersonated: ["Booking.com"], tactic_tags: ["qr-code"] },
      { intent_label: "phishing", brands_impersonated: ["ATO"], tactic_tags: ["fake-invoice"] },
    ];
    // Baseline saw ATO (different casing) and fake-invoice, but never
    // Booking.com or qr-code.
    const baseline = [
      { brands_impersonated: ["ato"], tactic_tags: ["FAKE-INVOICE"] },
    ];
    const agg = aggregateWeeklyCohort(cohort, baseline);

    expect(agg.novelBrands).toEqual(["Booking.com"]);
    expect(agg.novelTactics).toEqual(["qr-code"]);
  });

  it("preserves original casing for novel brands and dedupes case-insensitively", () => {
    const cohort = [
      { intent_label: "phishing", brands_impersonated: ["PayID"], tactic_tags: [] },
      { intent_label: "phishing", brands_impersonated: ["payid"], tactic_tags: [] },
    ];
    const agg = aggregateWeeklyCohort(cohort, []);

    // Deduped to one entry, first-seen casing retained.
    expect(agg.novelBrands).toEqual(["PayID"]);
  });

  it("handles empty cohort and null array columns without throwing", () => {
    const agg = aggregateWeeklyCohort(
      [{ intent_label: null, brands_impersonated: null, tactic_tags: null }],
      [],
    );
    expect(agg.topBrands).toEqual([]);
    expect(agg.topCategories).toEqual([]);
    expect(agg.novelBrands).toEqual([]);
  });
});
