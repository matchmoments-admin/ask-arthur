import { describe, expect, it } from "vitest";
import {
  buildUpsertRow,
  computeNrdUrl,
  yesterdayUtc,
} from "../shopfront-nrd-daily-ingest";

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

describe("computeNrdUrl", () => {
  it("encodes 2026-05-23 to the live URL the operator pasted from whoisds", () => {
    const url = computeNrdUrl(new Date(Date.UTC(2026, 4, 23)));
    expect(url).toBe(
      "https://www.whoisds.com/whois-database/newly-registered-domains/MjAyNi0wNS0yMy56aXA=/nrd",
    );
  });

  it("uses UTC date components even when the host TZ is non-UTC", () => {
    // Date(Date.UTC(...)) bypasses local-TZ pitfalls; formatUtcDate
    // also uses getUTC* methods. Sanity-check the boundary case.
    const url = computeNrdUrl(new Date(Date.UTC(2026, 0, 1)));
    expect(url).toContain(
      Buffer.from("2026-01-01.zip", "utf8").toString("base64"),
    );
  });

  it("zero-pads month and day", () => {
    const url = computeNrdUrl(new Date(Date.UTC(2026, 0, 5)));
    expect(url).toContain(
      Buffer.from("2026-01-05.zip", "utf8").toString("base64"),
    );
  });
});

describe("yesterdayUtc", () => {
  it("returns the day before the given Date in UTC", () => {
    const today = new Date(Date.UTC(2026, 4, 24));
    const y = yesterdayUtc(today);
    expect(y.getUTCFullYear()).toBe(2026);
    expect(y.getUTCMonth()).toBe(4);
    expect(y.getUTCDate()).toBe(23);
  });

  it("rolls the month boundary backwards correctly", () => {
    const may1 = new Date(Date.UTC(2026, 4, 1));
    const apr30 = yesterdayUtc(may1);
    expect(apr30.getUTCMonth()).toBe(3); // April
    expect(apr30.getUTCDate()).toBe(30);
  });
});
