import { describe, expect, it, vi } from "vitest";

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: { createFunction: vi.fn(() => ({})), send: vi.fn() },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_: unknown, fn: unknown) => fn,
}));
vi.mock("@askarthur/scam-engine/active-watchlist", () => ({
  getActiveWatchlistDetailed: vi.fn(),
}));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({ sendAdminTelegramMessage: vi.fn() }));

import { buildBrandResolver, type BrandEntry } from "@askarthur/shopfront-glue";
import {
  selectDiscoverCandidates,
  type KnownBrandCoverageRow,
} from "@/app/api/inngest/functions/known-brands-discover";
import { canonicalBrandKeyResolver } from "@/lib/clone-watch/canonical-brand-key";

// #1304: the discover worklist reads the ONE roster (the active watchlist) and
// matches known_brands on the Canonical Brand or the domain — not on the
// deriveBrandKey slug. Rotation across runs is in knownBrandsRosterSql.test.ts.
//
// Go-red (2026-10-13): against the pre-#1304 fn these cases cannot even be
// written — it exported no selector and read AU_BRAND_WATCHLIST inline, so an
// overlay brand (the "overlay brand with no row" case) was never a candidate.

let nextId = 1;
const row = (r: Partial<KnownBrandCoverageRow>): KnownBrandCoverageRow => ({
  id: nextId++,
  brand_name: null,
  brand_domain: null,
  contact_type: "email",
  probed_at: null,
  ...r,
});
const noAliases = canonicalBrandKeyResolver(buildBrandResolver({}));

describe("selectDiscoverCandidates", () => {
  it("an overlay brand with no known_brands row is a candidate", () => {
    const roster: BrandEntry[] = [{ brand: "Paying Co", legitimate_domains: ["payingco.com.au"] }];
    expect(selectDiscoverCandidates(roster, [], noAliases)).toEqual([
      { brand: "Paying Co", domain: "payingco.com.au", source: "roster" },
    ]);
  });

  it("covered by a row on the brand's domain even under a different name (CBA / Commonwealth Bank)", () => {
    const roster: BrandEntry[] = [{ brand: "CBA", legitimate_domains: ["commbank.com.au"] }];
    const rows = [row({ brand_name: "Commonwealth Bank", brand_domain: "commbank.com.au" })];
    expect(selectDiscoverCandidates(roster, rows, noAliases)).toEqual([]);
  });

  it("covered by the Canonical Brand when the domains differ (Google: google.com vs google.com.au)", () => {
    const roster: BrandEntry[] = [{ brand: "Google", legitimate_domains: ["google.com"] }];
    const rows = [row({ brand_name: "Google", brand_domain: "google.com.au" })];
    expect(selectDiscoverCandidates(roster, rows, noAliases)).toEqual([]);
  });

  it("the alias layer resolves a short form to its canonical row", () => {
    const resolve = canonicalBrandKeyResolver(
      buildBrandResolver({ auspost: "Australia Post", australiapost: "Australia Post" }),
    );
    const roster: BrandEntry[] = [{ brand: "AusPost", legitimate_domains: ["auspost.net"] }];
    const rows = [row({ brand_name: "Australia Post", brand_domain: "auspost.com.au" })];
    expect(selectDiscoverCandidates(roster, rows, resolve)).toEqual([]);
    expect(selectDiscoverCandidates(roster, rows, noAliases)).toHaveLength(1);
  });

  it("a probed miss covers; an unprobed seeded row is a candidate, first, and not doubled by the roster", () => {
    const roster: BrandEntry[] = [
      { brand: "Early", legitimate_domains: ["early.com.au"] },
      { brand: "Seeded Co", legitimate_domains: ["seededco.com.au"] },
      { brand: "Missed", legitimate_domains: ["missed.com.au"] },
    ];
    const rows = [
      row({ brand_name: "Missed", brand_domain: "missed.com.au", contact_type: "none", probed_at: "2026-09-01" }),
      row({ brand_name: "Seeded Co", brand_domain: "seededco.com.au", contact_type: "none" }),
    ];
    expect(selectDiscoverCandidates(roster, rows, noAliases)).toEqual([
      { brand: "Seeded Co", domain: "seededco.com.au", source: "seed" },
      { brand: "Early", domain: "early.com.au", source: "roster" },
    ]);
  });

  it("skips a roster brand with no domain, and caps the run", () => {
    const roster: BrandEntry[] = [
      { brand: "No Domain", legitimate_domains: [] },
      ...Array.from({ length: 20 }, (_, i) => ({ brand: `B${i}`, legitimate_domains: [`b${i}.com`] })),
    ];
    const out = selectDiscoverCandidates(roster, [], noAliases, 15);
    expect(out).toHaveLength(15);
    expect(out.map((c) => c.brand)).not.toContain("No Domain");
  });
});
