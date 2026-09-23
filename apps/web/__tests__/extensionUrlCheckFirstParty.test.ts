import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * /api/extension/url-check reads Ask Arthur's own threat URLs through the ONE
 * First-party URL Reputation module (checkAnalyzeUrlReputation), not a private
 * `scam_urls` query. The real module runs here against an in-memory
 * `scam_urls` that honours the query's filters, so these tests pin the
 * PREDICATE and the KEYS, not a mock of them.
 *
 * Go-red record (2026-09-23):
 *   - "report-driven high row does not flag": reinstate the old route body
 *     (`.eq("normalized_url", …).eq("is_active", true).single()`, found=true
 *     on any row) → fails (found:true for a row whose only source is
 *     `user_report`).
 *   - "/login on a clone host-root flags": same reinstatement → fails (the
 *     exact-URL lookup misses `https://x.shop/login` when the row is the host
 *     root `https://x.shop/`).
 */

type Row = {
  normalized_url: string;
  is_active: boolean;
  confidence_level: string;
  feed_sources: string[] | null;
  brand_impersonated: string | null;
  report_count: number;
};
const table: Row[] = [];

// A query builder that APPLIES in/eq/overlaps, so a private query that skips
// the source gate would see the report-driven row and the test would catch it.
function builder() {
  const preds: Array<(r: Row) => boolean> = [];
  let single = false;
  const b: Record<string, unknown> = {};
  b.from = () => b;
  b.select = () => b;
  b.limit = () => b;
  b.in = (col: keyof Row, vals: unknown[]) => {
    preds.push((r) => vals.includes(r[col]));
    return b;
  };
  b.eq = (col: keyof Row, val: unknown) => {
    preds.push((r) => r[col] === val);
    return b;
  };
  b.overlaps = (col: keyof Row, vals: string[]) => {
    preds.push((r) => ((r[col] as string[] | null) ?? []).some((v) => vals.includes(v)));
    return b;
  };
  b.single = () => {
    single = true;
    return b;
  };
  b.maybeSingle = b.single;
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
    const rows = table.filter((r) => preds.every((p) => p(r)));
    const data = single ? (rows[0] ?? null) : rows;
    return Promise.resolve({ data, error: null }).then(res, rej);
  };
  return b;
}

vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => builder() }));
const flags = vi.hoisted(() => ({ analyzeFirstPartyUrls: true, redirectResolve: false }));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), flush: async () => {} }),
}));
const gsb = vi.hoisted(() => vi.fn());
vi.mock("@askarthur/scam-engine/safebrowsing", () => ({ checkURLReputation: gsb }));
vi.mock("@askarthur/scam-engine/redirect-resolver", () => ({ resolveRedirectChain: vi.fn() }));
vi.mock("@/app/api/extension/_lib/auth", () => ({
  validateExtensionRequest: vi.fn(async () => ({
    valid: true,
    installId: "test-install",
    remaining: 42,
    requestId: null,
  })),
}));

import { POST } from "@/app/api/extension/url-check/route";

function req(url: string) {
  const body = JSON.stringify({ url });
  return new NextRequest("http://localhost/api/extension/url-check", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

const CLONE_ROOT: Row = {
  normalized_url: "https://coinbase-transaction.shop/",
  is_active: true,
  confidence_level: "high",
  feed_sources: ["clone_watch"],
  brand_impersonated: "coinbase.com",
  report_count: 0,
};
// upsert_scam_url scores four distinct reporters 'high' — abuse-reachable.
const REPORTED: Row = {
  normalized_url: "https://legit-florist.com.au/",
  is_active: true,
  confidence_level: "high",
  feed_sources: ["user_report"],
  brand_impersonated: null,
  report_count: 4,
};

beforeEach(() => {
  table.length = 0;
  table.push(CLONE_ROOT, REPORTED);
  flags.analyzeFirstPartyUrls = true;
  gsb.mockReset();
  gsb.mockImplementation(async (urls: string[]) =>
    urls.map((url) => ({ url, isMalicious: false, sources: [] })),
  );
});

describe("POST /api/extension/url-check — First-party URL Reputation", () => {
  it("does NOT flag a report-driven high row (no verified first-party source)", async () => {
    const res = await POST(req("https://legit-florist.com.au/"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.found).toBe(false);
    expect(body.threatLevel).toBeUndefined();
  });

  it("flags a /login path on a clone_watch host-root row, HIGH, citing the brand", async () => {
    const res = await POST(req("https://www.coinbase-transaction.shop/login?utm_source=sms"));
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.threatLevel).toBe("HIGH");
    expect(body.safeBrowsing.isMalicious).toBe(true);
    expect(body.safeBrowsing.sources).toEqual([
      "Ask Arthur Clone Watch (live impersonation of coinbase.com)",
    ]);
    expect(body.domain).toBe("coinbase-transaction.shop");
  });

  it("still reports a GSB/VT hit as HIGH through the same seam", async () => {
    gsb.mockImplementation(async (urls: string[]) =>
      urls.map((url) => ({ url, isMalicious: true, sources: ["Google Safe Browsing"] })),
    );
    const body = await (await POST(req("https://phish.example.net/"))).json();
    expect(body).toMatchObject({
      found: true,
      threatLevel: "HIGH",
      safeBrowsing: { isMalicious: true, sources: ["Google Safe Browsing"] },
    });
  });

  it("clean URL: found=false and the clean reputation result is passed through", async () => {
    const body = await (await POST(req("https://example.org/"))).json();
    expect(body).toEqual({
      found: false,
      domain: "example.org",
      safeBrowsing: { isMalicious: false, sources: [] },
    });
  });
});
