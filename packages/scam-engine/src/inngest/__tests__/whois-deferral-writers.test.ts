import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1253 / #1259 review — the scam_urls writers must not stamp an unanswered
 * WHOIS lookup (quota guard / 429 / non-200 / no key) as data. Writing nulls
 * over existing values and `whois_lookup_at = now` poisons whois-cached.ts
 * (180-day cache) and /api/scam-urls/report (whois_lookup_at non-null is its
 * domain cache key). Both writers go through `whoisScamUrlColumns`.
 *
 * Go-red record (2026-09-27, each reverted → failed → restored):
 *   - enrichment.ts: `...whoisScamUrlColumns(...)` replaced by the old inline
 *     whois_* object → "enrichment.ts: a deferred lookup writes no whois_*"
 *     fails (whois_lookup_at present).
 *   - on-demand-url-enrich.ts: same replacement → "on-demand: a deferred
 *     lookup writes no whois_*" fails.
 */

const m = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  lookupWhois: vi.fn(),
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: (_c: unknown, _t: unknown, handler: unknown) => handler,
  },
}));
vi.mock("../with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({}, { get: () => true }),
}));
vi.mock("../../ssl", () => ({
  checkSSL: async () => ({ valid: true, issuer: "LE", daysRemaining: 30 }),
}));
vi.mock("../../whois", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../whois")>()),
  lookupWhois: m.lookupWhois,
}));
vi.mock("../events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../events")>()),
  parseAnalyzeCompletedData: (raw: unknown) => raw,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["from", "select", "eq", "in", "limit"]) {
      chain[k] = () => chain;
    }
    chain.update = (u: Record<string, unknown>) => {
      m.updates.push(u);
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: 1 }], error: null }).then(resolve);
    return chain;
  },
}));

import { enrichDomain } from "../enrichment";
import { onDemandUrlEnrich } from "../on-demand-url-enrich";

const DEFERRED = {
  registrar: null,
  registrarAbuseEmail: null,
  registrantCountry: null,
  createdDate: null,
  expiresDate: null,
  nameServers: [],
  isPrivate: false,
  raw: null,
  deferral: {
    reason: "quota_deferred" as const,
    retryAfter: "2026-10-01T00:00:00.000Z",
    status: 429,
  },
};
const SERVED = { ...DEFERRED, registrar: "R", deferral: undefined };

const whoisKeys = (u: Record<string, unknown>) =>
  Object.keys(u).filter((k) => k.startsWith("whois_"));

beforeEach(() => {
  m.updates.length = 0;
  m.lookupWhois.mockReset();
});

describe("enrichment.ts enrichDomain", () => {
  it("enrichment.ts: a deferred lookup writes no whois_* (SSL + status still written)", async () => {
    m.lookupWhois.mockResolvedValue(DEFERRED);
    await enrichDomain({ domain: "x.example", urlIds: [1] });
    expect(m.updates).toHaveLength(1);
    expect(whoisKeys(m.updates[0]!)).toEqual([]);
    expect(m.updates[0]).toMatchObject({
      ssl_valid: true,
      enrichment_status: "completed",
    });
  });

  it("a served lookup writes the whois_* columns", async () => {
    m.lookupWhois.mockResolvedValue(SERVED);
    await enrichDomain({ domain: "x.example", urlIds: [1] });
    expect(m.updates[0]).toMatchObject({ whois_registrar: "R" });
    expect(m.updates[0]).toHaveProperty("whois_lookup_at");
  });
});

describe("on-demand-url-enrich", () => {
  const run = () =>
    (onDemandUrlEnrich as unknown as (ctx: unknown) => Promise<unknown>)({
      event: { data: { urlResults: [{ url: "https://x.example/a" }] } },
      step: { run: async (_n: string, fn: () => unknown) => fn() },
    });

  it("on-demand: a deferred lookup writes no whois_*", async () => {
    m.lookupWhois.mockResolvedValue(DEFERRED);
    await run();
    expect(m.updates).toHaveLength(1);
    expect(whoisKeys(m.updates[0]!)).toEqual([]);
    expect(m.updates[0]).toMatchObject({ enrichment_status: "completed" });
  });

  it("on-demand: a served lookup writes the whois_* columns", async () => {
    m.lookupWhois.mockResolvedValue(SERVED);
    await run();
    expect(m.updates[0]).toMatchObject({ whois_registrar: "R" });
  });
});
