import { describe, expect, it } from "vitest";
import {
  computeDurationKpis,
  formatMedianHours,
  medianOf,
  registrarWeaponisation,
  tldOf,
  tldWeaponisation,
  UNKNOWN_REGISTRAR,
} from "@/lib/clone-watch/duration-kpis";
import type { CloneAlertRow } from "@/app/api/inngest/functions/report-brand-stewardship";

/** Minimal row factory — only the fields the duration module reads. */
function row(over: Partial<CloneAlertRow> & { candidate_domain: string }): CloneAlertRow {
  return {
    id: 1,
    inferred_target_domain: "brand.com.au",
    urlscan_classification: null,
    urlscan_evidence: null,
    attribution: null,
    submitted_to: null,
    lifecycle_state: null,
    netcraft_declined_at: null,
    weaponised_at: null,
    first_seen_at: null,
    ...over,
  };
}

const T0 = "2026-07-01T00:00:00Z";
const T0_PLUS_12H = "2026-07-01T12:00:00Z";
const T0_PLUS_24H = "2026-07-02T00:00:00Z";
const T0_PLUS_48H = "2026-07-03T00:00:00Z";
const T0_PLUS_72H = "2026-07-04T00:00:00Z";

describe("computeDurationKpis", () => {
  it("computes all four legs for a complete loop", () => {
    const kpis = computeDurationKpis([
      row({
        candidate_domain: "brand-login.shop",
        netcraft_declined_at: T0,
        weaponised_at: T0_PLUS_24H,
        submitted_to: {
          netcraft: { submitted_at: T0, takedown_at: T0_PLUS_72H },
          netcraft_issue: { issue_reported_at: T0_PLUS_48H },
        },
      }),
    ]);
    expect(kpis.declineToWeaponise).toEqual({ n: 1, medianHours: 24 });
    expect(kpis.weaponiseToRefile).toEqual({ n: 1, medianHours: 24 });
    expect(kpis.refileToTakedown).toEqual({ n: 1, medianHours: 24 });
    expect(kpis.fullLoop).toEqual({ n: 1, medianHours: 72 });
    expect(kpis.excludedNegativeN).toBe(0);
  });

  it("excludes inverted decline→weaponise pairs (last-touch pathology) and counts them", () => {
    const kpis = computeDurationKpis([
      // declined re-stamped AFTER weaponisation — must not produce a negative leg
      row({
        candidate_domain: "a.shop",
        netcraft_declined_at: T0_PLUS_48H,
        weaponised_at: T0_PLUS_24H,
      }),
      row({
        candidate_domain: "b.shop",
        netcraft_declined_at: T0,
        weaponised_at: T0_PLUS_12H,
      }),
    ]);
    expect(kpis.declineToWeaponise).toEqual({ n: 1, medianHours: 12 });
    expect(kpis.excludedNegativeN).toBe(1);
    expect(kpis.anomalousInversionsN).toBe(0);
  });

  it("counts inversions on non-decline legs as anomalous, not decline pathology", () => {
    const kpis = computeDurationKpis([
      // takedown witnessed BEFORE the re-file stamp (10:00 reconciler vs
      // 11:00 filer) — an anomaly on two legs, zero decline pathology.
      row({
        candidate_domain: "odd.shop",
        submitted_to: {
          netcraft: { submitted_at: T0_PLUS_72H, takedown_at: T0_PLUS_24H },
          netcraft_issue: { issue_reported_at: T0_PLUS_48H },
        },
      }),
    ]);
    expect(kpis.excludedNegativeN).toBe(0);
    expect(kpis.anomalousInversionsN).toBe(2); // refile→takedown + full loop
  });

  it("ignores skip-stamped netcraft_issue keys without issue_reported_at", () => {
    const kpis = computeDurationKpis([
      row({
        candidate_domain: "skipped.shop",
        weaponised_at: T0,
        submitted_to: { netcraft_issue: { skipped: "dead_at_probe" } },
      }),
    ]);
    expect(kpis.weaponiseToRefile).toEqual({ n: 0, medianHours: null });
  });

  it("returns null medians (never 0) on an empty cohort", () => {
    const kpis = computeDurationKpis([]);
    expect(kpis.fullLoop).toEqual({ n: 0, medianHours: null });
    expect(kpis.declineToWeaponise.medianHours).toBeNull();
    expect(kpis.excludedNegativeN).toBe(0);
  });

  it("interpolates even-count medians like percentile_cont", () => {
    const kpis = computeDurationKpis([
      row({
        candidate_domain: "a.shop",
        netcraft_declined_at: T0,
        weaponised_at: T0_PLUS_12H, // 12h
      }),
      row({
        candidate_domain: "b.shop",
        netcraft_declined_at: T0,
        weaponised_at: T0_PLUS_24H, // 24h
      }),
    ]);
    expect(kpis.declineToWeaponise).toEqual({ n: 2, medianHours: 18 });
  });

  it("dedupes repeated candidate_domain rows (first wins)", () => {
    const dup = {
      candidate_domain: "dup.shop",
      netcraft_declined_at: T0,
      weaponised_at: T0_PLUS_24H,
    };
    const kpis = computeDurationKpis([row(dup), row({ ...dup, id: 2 })]);
    expect(kpis.declineToWeaponise.n).toBe(1);
  });

  it("stamps asOf from the provided clock", () => {
    const now = new Date("2026-07-16T09:00:00Z");
    expect(computeDurationKpis([], now).asOf).toBe(now.toISOString());
  });
});

describe("medianOf / formatMedianHours", () => {
  it("medianOf interpolates like percentile_cont and returns null on empty", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([7])).toBe(7);
    expect(medianOf([2, 4])).toBe(3);
    expect(medianOf([1, 2, 100])).toBe(2);
  });

  it("formatMedianHours never renders a fake 0h", () => {
    expect(formatMedianHours(0)).toBe("<1h");
    expect(formatMedianHours(1)).toBe("1h");
    expect(formatMedianHours(33)).toBe("33h");
    expect(formatMedianHours(48)).toBe("2.0 days");
    expect(formatMedianHours(323)).toBe("13.5 days");
  });
});

describe("registrarWeaponisation", () => {
  it("canonicalises registrars and buckets null/redacted as Unknown", () => {
    const rows = [
      row({
        candidate_domain: "a.shop",
        weaponised_at: T0_PLUS_48H,
        first_seen_at: T0,
        attribution: { whois: { registrar: "NAMECHEAP INC" } },
      }),
      row({
        candidate_domain: "b.shop",
        weaponised_at: T0_PLUS_24H,
        first_seen_at: T0,
        attribution: { whois: { registrar: "NameCheap, Inc." } },
      }),
      row({
        candidate_domain: "c.shop",
        weaponised_at: T0_PLUS_24H,
        first_seen_at: T0,
        attribution: null,
      }),
      // never weaponised — excluded entirely
      row({ candidate_domain: "d.shop", first_seen_at: T0 }),
    ];
    const cut = registrarWeaponisation(rows);
    expect(cut).toEqual([
      { registrar: "NameCheap", weaponised: 2, medianDaysToWeaponise: 2 },
      { registrar: UNKNOWN_REGISTRAR, weaponised: 1, medianDaysToWeaponise: 1 },
    ]);
  });

  it("counts a weaponisation with a missing first_seen_at but keeps the median clean", () => {
    const cut = registrarWeaponisation([
      row({
        candidate_domain: "a.shop",
        weaponised_at: T0_PLUS_24H,
        first_seen_at: null,
        attribution: { whois: { registrar: "Porkbun LLC" } },
      }),
    ]);
    expect(cut).toEqual([
      { registrar: "Porkbun", weaponised: 1, medianDaysToWeaponise: null },
    ]);
  });
});

describe("tldOf / tldWeaponisation", () => {
  it("handles multi-part AU suffixes and plain TLDs", () => {
    expect(tldOf("commbank-login.com.au")).toBe("com.au");
    expect(tldOf("brand-sale.shop")).toBe("shop");
    expect(tldOf("brand.co.uk")).toBe("co.uk");
    // a bare two-label domain's TLD is its last label, not a fake suffix match
    expect(tldOf("com.au")).toBe("au");
  });

  it("counts weaponised clones per TLD", () => {
    const cut = tldWeaponisation([
      row({ candidate_domain: "a.shop", weaponised_at: T0 }),
      row({ candidate_domain: "b.shop", weaponised_at: T0 }),
      row({ candidate_domain: "c.com.au", weaponised_at: T0 }),
      row({ candidate_domain: "never.online" }),
    ]);
    expect(cut).toEqual([
      { tld: "shop", weaponised: 2 },
      { tld: "com.au", weaponised: 1 },
    ]);
  });
});
