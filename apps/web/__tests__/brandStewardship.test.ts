import { describe, expect, it } from "vitest";
import {
  aggregateOnwardByBrand,
  deriveBrandKey,
  matchKnownBrand,
  priorMonthStart,
} from "@/app/api/inngest/functions/report-brand-stewardship";

describe("deriveBrandKey", () => {
  it("matches the SQL convention (lower + non-alnum → _)", () => {
    expect(deriveBrandKey("JB Hi-Fi")).toBe("jb_hi_fi");
    expect(deriveBrandKey("Australia Post")).toBe("australia_post");
    expect(deriveBrandKey("CommBank")).toBe("commbank");
  });

  // Contract test (ultrareview F4): these MUST stay equal to the v119 SQL
  // `lower(regexp_replace(brand, '[^a-zA-Z0-9]+', '_', 'g'))`. If that SQL
  // formula ever changes (e.g. starts trimming trailing `_`), this TS copy
  // would silently mis-join brands to known_brands contacts → a brand's
  // stewardship report routes to the wrong/no recipient. Edge cases chosen to
  // catch exactly that drift: punctuation runs, trailing punctuation, digits.
  it("agrees with the SQL formula on drift-prone edge cases", () => {
    expect(deriveBrandKey("St.George Bank")).toBe("st_george_bank");
    // A run of non-alnum collapses to ONE underscore; trailing ")" leaves a
    // trailing "_" (Postgres regexp_replace does NOT trim) — both must match.
    expect(deriveBrandKey("Linkt (Transurban)")).toBe("linkt_transurban_");
    expect(deriveBrandKey("7-Eleven")).toBe("7_eleven");
    expect(deriveBrandKey("Domino's")).toBe("domino_s");
    expect(deriveBrandKey(" Westpac ")).toBe("_westpac_");
  });
});

describe("aggregateOnwardByBrand", () => {
  const brandById = new Map<number, string>([
    [1, "Australia Post"],
    [2, "Australia Post"],
    [3, "CommBank"],
  ]);

  it("counts only SENT rows and de-dupes detected by scam_report_id", () => {
    const rows = [
      { scam_report_id: 1, destination: "openphish", status: "sent" },
      { scam_report_id: 1, destination: "apwg", status: "sent" }, // same scam, 2nd dest
      { scam_report_id: 2, destination: "openphish", status: "sent" },
      { scam_report_id: 3, destination: "openphish", status: "queued" }, // not sent → ignored
    ];
    const agg = aggregateOnwardByBrand(rows, brandById);

    const auspost = agg.get("Australia Post")!;
    expect(auspost.detected).toBe(2); // scam 1 + scam 2 (not double-counted by dest)
    expect(auspost.reportsSent).toBe(3);
    expect(auspost.reportedByDestination).toEqual({ openphish: 2, apwg: 1 });
    expect(auspost.scamReportIds.sort()).toEqual([1, 2]);

    // CommBank's only row was 'queued' → no entry (we never claim unsent reports).
    expect(agg.has("CommBank")).toBe(false);
  });

  it("ignores rows whose scam_report_id has no resolved brand", () => {
    const rows = [{ scam_report_id: 99, destination: "openphish", status: "sent" }];
    expect(aggregateOnwardByBrand(rows, brandById).size).toBe(0);
  });
});

describe("matchKnownBrand", () => {
  const contacts = [
    { brand_key: "auspost", brand_name: "Australia Post", security_contact_email: "abuse@auspost.com.au" },
    { brand_key: "cba", brand_name: "CommBank", security_contact_email: null },
  ];

  it("matches by brand_name case-insensitively", () => {
    const m = matchKnownBrand("australia post", contacts);
    expect(m?.security_contact_email).toBe("abuse@auspost.com.au");
  });

  it("skips contacts without an email even on a name match", () => {
    // "CommBank" matches by name but has no email → no usable contact.
    expect(matchKnownBrand("CommBank", contacts)).toBeNull();
  });

  it("returns null when no brand matches", () => {
    expect(matchKnownBrand("Telstra", contacts)).toBeNull();
  });
});

describe("priorMonthStart", () => {
  it("returns the first day of the previous month (UTC)", () => {
    expect(priorMonthStart(new Date("2026-05-29T09:00:00Z")).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
  });

  it("handles the January → December year rollover", () => {
    expect(priorMonthStart(new Date("2026-01-01T09:00:00Z")).toISOString()).toBe(
      "2025-12-01T00:00:00.000Z",
    );
  });
});
