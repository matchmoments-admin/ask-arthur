import { describe, expect, it } from "vitest";
import { buildUpsertRow } from "../shopfront-nrd-daily-ingest";

const baseHit = {
  candidate_domain: "bunings-au-deals.shop",
  candidate_url: "https://bunings-au-deals.shop/",
  url_hash:
    "0000000000000000000000000000000000000000000000000000000000000000",
  brand: "Bunnings",
  legitimate_domain: "bunnings.com.au",
  signal_type: "substring",
  evidence: { input_label: "bunings-au-deals", brand: "bunnings" },
};

describe("buildUpsertRow", () => {
  it("emits the locked Layer-0 row shape (target_shop_id empty, source=nrd)", () => {
    const row = buildUpsertRow({ ...baseHit, score: 0.85 });
    expect(row.target_shop_id).toBe("");
    expect(row.inferred_target_domain).toBe("bunnings.com.au");
    expect(row.source).toBe("nrd");
  });

  it("uses Math.floor so score=0.95 caps at severity 38 (low tier)", () => {
    const row = buildUpsertRow({ ...baseHit, score: 0.95 });
    expect(row.severity).toBe(38);
    expect(row.severity_tier).toBe("low");
  });

  it("uses Math.floor so score=0.85 (substring) → severity 34 (low tier)", () => {
    const row = buildUpsertRow({ ...baseHit, score: 0.85 });
    expect(row.severity).toBe(34);
    expect(row.severity_tier).toBe("low");
  });

  it("never escapes the low tier at MVP — score=0.9 (confusable) → severity 36", () => {
    const row = buildUpsertRow({ ...baseHit, score: 0.9 });
    expect(row.severity).toBe(36);
    expect(row.severity_tier).toBe("low");
  });

  it("wraps the match details in the ADR-0015 signals shape", () => {
    const row = buildUpsertRow({ ...baseHit, score: 0.85 });
    expect(Array.isArray(row.signals)).toBe(true);
    expect(row.signals).toHaveLength(1);
    const sig = row.signals[0];
    expect(sig?.type).toBe("brand_match");
    expect(sig?.score).toBe(0.85);
    expect(sig?.signal_type).toBe("substring");
    expect(sig?.evidence).toEqual({
      input_label: "bunings-au-deals",
      brand: "bunnings",
    });
    expect(typeof sig?.fired_at).toBe("string");
  });
});
