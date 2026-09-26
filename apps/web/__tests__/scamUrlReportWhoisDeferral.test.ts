import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1253 / #1259 review — /api/scam-urls/report must not write an unanswered
 * WHOIS lookup as data. `whois_lookup_at` non-null is this route's
 * domain-level cache key (it copies WHOIS from any other row of the domain
 * that has it), so stamping it on a deferred or failed lookup handed the
 * empty result to every later report of that domain.
 *
 * Go-red record (2026-09-27, each reverted → failed → restored):
 *   - `Object.assign(updateData, whoisScamUrlColumns(...))` replaced by the
 *     old unconditional whois_* assignments → "a deferred lookup writes no
 *     whois_*" fails.
 *   - the catch branch's `updateData.whois_lookup_at = …` restored → "a
 *     failed WHOIS/SSL attempt stamps no whois_lookup_at" fails.
 */

const m = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  lookupWhois: vi.fn(),
  checkSSL: vi.fn(),
}));

vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({}, { get: () => true }),
}));
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkFormRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@askarthur/utils/hash", () => ({
  hashIdentifier: async () => "h",
}));
vi.mock("@askarthur/scam-engine/geolocate", () => ({
  geolocateIP: async () => ({ region: null }),
}));
vi.mock("@askarthur/scam-engine/ssl", () => ({ checkSSL: m.checkSSL }));
vi.mock("@askarthur/scam-engine/whois", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@askarthur/scam-engine/whois")>()),
  lookupWhois: m.lookupWhois,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["from", "select", "eq", "not", "neq", "limit"]) {
      chain[k] = () => chain;
    }
    // No other row of the domain carries WHOIS → fresh lookup path.
    chain.single = async () => ({ data: null, error: null });
    chain.update = (u: Record<string, unknown>) => {
      m.updates.push(u);
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve);
    chain.rpc = async () => ({
      data: { scam_url_id: 1, report_count: 1, is_new: true },
      error: null,
    });
    return chain;
  },
}));

import { POST } from "@/app/api/scam-urls/report/route";

const post = () =>
  POST(
    new Request("http://localhost/api/scam-urls/report", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "1.2.3.4" },
      body: JSON.stringify({
        urls: [{ url: "https://evil.example/login" }],
        urlCheckResults: [
          {
            url: "https://evil.example/login",
            isMalicious: false,
            sources: [],
          },
        ],
      }),
    }) as never,
  );

const EMPTY = {
  registrar: null,
  registrarAbuseEmail: null,
  registrantCountry: null,
  createdDate: null,
  expiresDate: null,
  nameServers: [],
  isPrivate: false,
  raw: null,
};
const whoisKeys = () =>
  m.updates
    .flatMap((u) => Object.keys(u))
    .filter((k) => k.startsWith("whois_"));

beforeEach(() => {
  m.updates.length = 0;
  m.lookupWhois.mockReset();
  m.checkSSL.mockReset();
  m.checkSSL.mockResolvedValue({
    valid: true,
    issuer: "LE",
    daysRemaining: 30,
  });
});

describe("/api/scam-urls/report WHOIS writes", () => {
  it("a deferred lookup writes no whois_* (SSL still written)", async () => {
    m.lookupWhois.mockResolvedValue({
      ...EMPTY,
      deferral: {
        reason: "quota_deferred",
        retryAfter: "2026-10-01T00:00:00.000Z",
      },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(whoisKeys()).toEqual([]);
    expect(m.updates[0]).toMatchObject({ ssl_valid: true });
  });

  it("a served lookup writes whois_* and the cache stamp", async () => {
    m.lookupWhois.mockResolvedValue({ ...EMPTY, registrar: "R" });
    await post();
    expect(m.updates[0]).toMatchObject({ whois_registrar: "R" });
    expect(whoisKeys()).toContain("whois_lookup_at");
  });

  it("a failed WHOIS/SSL attempt stamps no whois_lookup_at", async () => {
    m.lookupWhois.mockResolvedValue({ ...EMPTY, registrar: "R" });
    m.checkSSL.mockRejectedValue(new Error("tls"));
    await post();
    expect(whoisKeys()).toEqual([]);
  });
});
