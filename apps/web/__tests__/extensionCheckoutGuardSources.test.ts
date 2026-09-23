import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * /api/extension/analyze-checkout — which scam_urls rows may move a checkout
 * verdict (review 2026-09-23). The real first-party module and the route's own
 * feed query run against an in-memory scam_urls that APPLIES the filters, so
 * these pin predicates, not mocks:
 *   - a report-driven row (source_type 'text', 4 reports → 'high') must NOT
 *     count: anyone could put +35 on a legitimate shop's checkout;
 *   - a threat-feed row still counts (corroborating, SUSPICIOUS alone);
 *   - a verified clone-watch Platform Entity is decisive (HIGH_RISK), matched
 *     on the page's own keys so /checkout on a host-root row hits.
 */
type Row = {
  normalized_url: string;
  domain: string;
  subdomain: string | null;
  source_type: string;
  is_active: boolean;
  confidence_level: string;
  feed_sources: string[] | null;
  brand_impersonated: string | null;
};
const table: Row[] = [];

function builder() {
  const preds: Array<(r: Row) => boolean> = [];
  let single = false;
  const b: Record<string, unknown> = {};
  b.from = () => b;
  b.select = () => b;
  b.limit = () => b;
  b.in = (c: keyof Row, v: unknown[]) => (preds.push((r) => v.includes(r[c])), b);
  b.eq = (c: keyof Row, v: unknown) => (preds.push((r) => r[c] === v), b);
  b.overlaps = (c: keyof Row, v: string[]) =>
    (preds.push((r) => ((r[c] as string[] | null) ?? []).some((x) => v.includes(x))), b);
  // Only the route's bare-host subdomain filter uses .or().
  b.or = () => (preds.push((r) => !r.subdomain || r.subdomain === "www"), b);
  b.maybeSingle = () => ((single = true), b);
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
    const rows = table.filter((r) => preds.every((p) => p(r)));
    return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(res, rej);
  };
  return b;
}

vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => builder() }));
const flags = vi.hoisted(() => ({ checkoutGuard: true, analyzeFirstPartyUrls: true }));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));
vi.mock("@askarthur/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), flush: async () => {} }),
}));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: vi.fn(), logCostAsync: vi.fn() }));
vi.mock("@askarthur/scam-engine/whois-cached", () => ({
  getDomainCreatedDate: vi.fn(async () => ({ createdDate: null })),
  domainAgeDays: () => null,
  domainAgeBand: () => "unknown",
}));
vi.mock("@askarthur/scam-engine/active-watchlist", () => ({ getActiveWatchlist: async () => [] }));
vi.mock("@/app/api/extension/_lib/auth", () => ({
  validateExtensionRequest: vi.fn(async () => ({ valid: true, remaining: 10, installId: "t" })),
}));

import { POST } from "@/app/api/extension/analyze-checkout/route";

const call = async (url: string) =>
  (await POST(
    new NextRequest("http://localhost/api/extension/analyze-checkout", {
      method: "POST",
      body: JSON.stringify({ url }),
      headers: { "content-type": "application/json" },
    }),
  ).then((r) => r.json())) as { verdict: string; reasons: string[] };

const row = (o: Partial<Row> & { normalized_url: string; domain: string }): Row => ({
  subdomain: null,
  source_type: "feed",
  is_active: true,
  confidence_level: "low",
  feed_sources: ["openphish"],
  brand_impersonated: null,
  ...o,
});

beforeEach(() => {
  table.length = 0;
  flags.analyzeFirstPartyUrls = true;
});

describe("checkout guard — which scam_urls rows count", () => {
  it("a report-driven 'high' row does NOT move the verdict", async () => {
    table.push(
      row({
        normalized_url: "https://petalflorist.net/",
        domain: "petalflorist.net",
        source_type: "text",
        confidence_level: "high",
        feed_sources: [],
      }),
    );
    expect((await call("https://petalflorist.net/checkout")).verdict).toBe("SAFE");
  });

  it("a threat-feed row still counts (corroborating)", async () => {
    table.push(row({ normalized_url: "https://cheapgoodz.net/", domain: "cheapgoodz.net" }));
    expect((await call("https://cheapgoodz.net/checkout")).verdict).toBe("SUSPICIOUS");
  });

  it("a verified clone-watch Platform Entity is decisive, even on a /checkout path", async () => {
    table.push(
      row({
        normalized_url: "https://paymt-portal.shop/",
        domain: "paymt-portal.shop",
        confidence_level: "high",
        feed_sources: ["clone_watch"],
        brand_impersonated: "coinbase.com",
      }),
    );
    const r = await call("https://paymt-portal.shop/checkout/pay");
    expect(r.verdict).toBe("HIGH_RISK");
    expect(r.reasons.join(" ")).toContain("Clone Watch");
  });

  it("first-party signal follows FF_ANALYZE_FIRST_PARTY_URLS", async () => {
    flags.analyzeFirstPartyUrls = false;
    table.push(
      row({
        normalized_url: "https://paymt-portal.shop/",
        domain: "paymt-portal.shop",
        confidence_level: "high",
        feed_sources: ["clone_watch"],
      }),
    );
    // Still a feed row (source_type 'feed'), so corroborating only.
    expect((await call("https://paymt-portal.shop/checkout")).verdict).toBe("SUSPICIOUS");
  });
});
