import { describe, expect, it } from "vitest";

import type { CloneDetectionRow } from "@/emails/BrandStewardshipReport";
import { cloneDetectionsFromMetrics } from "@/lib/email/brand-stewardship-clone-detections";
import {
  formatRegistered,
  squatView,
  squattingRows,
  squattingSummary,
} from "@/lib/clone-watch/squatting";

const row = (o: Partial<CloneDetectionRow> & { domain: string }): CloneDetectionRow => ({
  classification: null,
  ip: null,
  asn: null,
  country: null,
  registrar: null,
  abuseEmail: null,
  ...o,
});

describe("squatView", () => {
  it("lifecycle wins where it says more: weaponised → phishing, taken_down → blocklisted", () => {
    expect(squatView(row({ domain: "a", lifecycleState: "weaponised", squatStatus: "parked" }))).toBe("phishing");
    expect(squatView(row({ domain: "a", lifecycleState: "taken_down", squatStatus: "live" }))).toBe("taken_down");
  });

  it("otherwise the infrastructure status", () => {
    expect(squatView(row({ domain: "a", lifecycleState: "declined", squatStatus: "held" }))).toBe("held");
    expect(squatView(row({ domain: "a", squatStatus: "parked" }))).toBe("parked");
    expect(squatView(row({ domain: "a", squatStatus: "live" }))).toBe("live");
  });

  it("pre-squat-status ledger rows fall back to the urlscan classification", () => {
    expect(squatView(row({ domain: "a", classification: "likely_phishing" }))).toBe("phishing");
    expect(squatView(row({ domain: "a", classification: "parked_for_sale" }))).toBe("parked");
    expect(squatView(row({ domain: "a", classification: "neutral" }))).toBe("live");
    expect(squatView(row({ domain: "a", squatStatus: "unknown" }))).toBe("registered");
  });
});

describe("squattingRows / squattingSummary", () => {
  const rows = squattingRows([
    row({ domain: "held.xyz", squatStatus: "held" }),
    row({ domain: "old-parked.com", squatStatus: "parked", registeredAt: "2026-06-01" }),
    row({ domain: "phish.shop", lifecycleState: "weaponised" }),
    row({ domain: "new-parked.com", squatStatus: "parked", registeredAt: "2026-09-19" }),
    row({ domain: "gone.info", lifecycleState: "taken_down" }),
    row({ domain: "site.net", squatStatus: "live" }),
  ]);

  it("orders most urgent first, newest registration first within a status", () => {
    expect(rows.map((r) => r.domain)).toEqual([
      "phish.shop",
      "site.net",
      "new-parked.com",
      "old-parked.com",
      "held.xyz",
      "gone.info",
    ]);
  });

  it("summarises counts in the same priority order", () => {
    expect(squattingSummary(rows).map((s) => [s.view, s.count])).toEqual([
      ["phishing", 1],
      ["live", 1],
      ["parked", 2],
      ["held", 1],
      ["taken_down", 1],
    ]);
  });
});

describe("the stored ledger carries the new fields to the page", () => {
  it("maps squat_status + registered_at, and tolerates rows without them", () => {
    const view = cloneDetectionsFromMetrics({
      detected: 2,
      domains: [
        { domain: "nab-login.com", squat_status: "live", registered_at: "2026-09-19", registrar: "NameSilo, LLC" },
        { domain: "older.com" },
      ],
    });
    expect(view?.domains[0]).toMatchObject({ squatStatus: "live", registeredAt: "2026-09-19" });
    expect(view?.domains[1]).toMatchObject({ squatStatus: null, registeredAt: null });
  });
});

describe("formatRegistered", () => {
  it("formats an ISO date and rejects junk", () => {
    expect(formatRegistered("2026-09-19")).toBe("19 Sept 2026");
    expect(formatRegistered("2026-09-19T00:00:00Z")).toBe("19 Sept 2026");
    expect(formatRegistered("yesterday")).toBeNull();
    expect(formatRegistered(null)).toBeNull();
  });
});
