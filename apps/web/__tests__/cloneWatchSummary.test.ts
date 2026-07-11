import { describe, it, expect } from "vitest";
import type { CloneWatchReportCard } from "@/lib/clone-watch/report-card-data";
import { summaryRow } from "@/lib/clone-watch/report-summary";

const CARD: CloneWatchReportCard = {
  periodMonth: "2026-06-01",
  periodLabel: "June 2026",
  total: 804,
  brands: 129,
  kpis: {
    reportedToNetcraft: 628,
    likelyPhishing: 25,
    parkedForSale: 51,
    takenDown: 0,
    declined: 0,
    escalated: 0,
    weaponised: 0,
    weaponisedAfterDecline: 0,
    reTakenDown: 0,
  },
  topAuBrands: [{ brand: "target.com.au", clones: 43 }],
  globalBrands: [{ brand: "hellostake.com", clones: 53 }],
  topRegistrars: [{ registrar: "Dynadot", clones: 60 }],
  unknownRegistrarCount: 378,
  mom: {
    available: false,
    priorLabel: "May 2026",
    priorTotal: 0,
    priorBrands: 0,
    totalDelta: 804,
    totalPct: null,
    brandsDelta: 129,
  },
  superFund: { brand: "hesta.com.au", clones: 35, auRank: 2 },
};

describe("summaryRow", () => {
  it("maps the card to the summary-table columns", () => {
    const r = summaryRow(CARD);
    expect(r.period_month).toBe("2026-06-01");
    expect(r.total_domains).toBe(804);
    expect(r.brand_count).toBe(129);
    expect(r.reported_to_netcraft).toBe(628);
    expect(r.likely_phishing).toBe(25);
    expect(r.parked_for_sale).toBe(51);
    expect(r.unknown_registrar_count).toBe(378);
    expect(r.top_au_brands).toEqual(CARD.topAuBrands);
    expect(r.global_brands).toEqual(CARD.globalBrands);
    expect(r.top_registrars).toEqual(CARD.topRegistrars);
    expect(r.super_fund).toEqual(CARD.superFund);
    expect(r.mom).toEqual(CARD.mom);
    expect(typeof r.updated_at).toBe("string");
  });

  it("omits published_post_urn by default (so a re-snapshot preserves it)", () => {
    expect("published_post_urn" in summaryRow(CARD)).toBe(false);
  });

  it("includes published_post_urn only when provided (the write-back path)", () => {
    const r = summaryRow(CARD, "urn:li:ugcPost:123");
    expect(r.published_post_urn).toBe("urn:li:ugcPost:123");
  });
});
