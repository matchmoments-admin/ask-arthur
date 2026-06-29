import { describe, expect, it } from "vitest";
import {
  primarySignalType,
  passesStrictSignal,
  isAutoParkEligible,
  toSummaryItem,
  type AlertRow,
} from "@/app/api/inngest/functions/clone-watch-auto-triage";

function alert(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: 1,
    inferred_target_domain: "nab.com.au",
    candidate_domain: "nab-login.shop",
    candidate_url: "https://nab-login.shop/",
    signals: [{ signal_type: "confusable" }],
    urlscan_evidence: null,
    first_seen_at: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("toSummaryItem", () => {
  it("lifts hosting IP/country/ASN from urlscan_evidence.server", () => {
    const item = toSummaryItem(
      alert({
        urlscan_evidence: {
          screenshot_url: "https://urlscan.io/screenshots/x.png",
          server: { ip: "203.0.113.7", country: "RU", asn: "AS12345" },
        },
      }),
    );
    expect(item).toMatchObject({
      brand: "nab.com.au",
      candidateDomain: "nab-login.shop",
      hostingIp: "203.0.113.7",
      hostingCountry: "RU",
      asn: "AS12345",
      screenshotUrl: "https://urlscan.io/screenshots/x.png",
    });
  });

  it("falls back to nulls when urlscan evidence / server is missing", () => {
    const item = toSummaryItem(alert({ urlscan_evidence: null }));
    expect(item.hostingIp).toBeNull();
    expect(item.hostingCountry).toBeNull();
    expect(item.asn).toBeNull();
    expect(item.screenshotUrl).toBeNull();
  });

  it("uses candidate_domain as the brand when inferred_target_domain is null", () => {
    expect(toSummaryItem(alert({ inferred_target_domain: null })).brand).toBe(
      "nab-login.shop",
    );
  });
});

describe("primarySignalType", () => {
  it("reads signal_type from the first signal", () => {
    expect(
      primarySignalType([{ signal_type: "confusable", score: 0.9 }]),
    ).toBe("confusable");
  });

  it("returns null for empty / malformed signals", () => {
    expect(primarySignalType([])).toBeNull();
    expect(primarySignalType(null)).toBeNull();
    expect(primarySignalType("nope")).toBeNull();
    expect(primarySignalType([{ score: 1 }])).toBeNull();
  });
});

describe("passesStrictSignal", () => {
  it("accepts confusable and levenshtein primary signals", () => {
    expect(passesStrictSignal([{ signal_type: "confusable" }])).toBe(true);
    expect(passesStrictSignal([{ signal_type: "levenshtein" }])).toBe(true);
  });

  it("rejects the high-FP substring class and unknowns", () => {
    // 'substring' is the ~70%-raw-FP class the strict bar deliberately excludes.
    expect(passesStrictSignal([{ signal_type: "substring" }])).toBe(false);
    expect(passesStrictSignal([{ signal_type: "au_token" }])).toBe(false);
    expect(passesStrictSignal([])).toBe(false);
  });

  it("only considers the PRIMARY (first) signal", () => {
    // confusable buried behind a substring primary must NOT auto-qualify.
    expect(
      passesStrictSignal([
        { signal_type: "substring" },
        { signal_type: "confusable" },
      ]),
    ).toBe(false);
  });
});

describe("isAutoParkEligible", () => {
  it("parks not-a-clone rows with a weak (non-confusable/levenshtein) signal", () => {
    expect(isAutoParkEligible(true, [{ signal_type: "substring" }])).toBe(true);
    expect(isAutoParkEligible(true, [{ signal_type: "au_token" }])).toBe(true);
    expect(isAutoParkEligible(true, [])).toBe(true);
  });

  it("KEEPS not-a-clone rows that carry a strong brand-similarity signal", () => {
    // The conservative cut — a human still eyeballs these despite is_clone=false.
    expect(isAutoParkEligible(true, [{ signal_type: "confusable" }])).toBe(false);
    expect(isAutoParkEligible(true, [{ signal_type: "levenshtein" }])).toBe(false);
  });

  it("never parks a row Haiku considers a clone, regardless of signal", () => {
    expect(isAutoParkEligible(false, [{ signal_type: "substring" }])).toBe(false);
    expect(isAutoParkEligible(false, [{ signal_type: "confusable" }])).toBe(false);
  });
});
