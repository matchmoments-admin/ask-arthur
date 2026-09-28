import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR-F — pipeline-entity-enrichment must not mark an entity `completed` when
 * its WHOIS was HELD by the batch guard (`quota_unknown`: the monthly count
 * was unreadable, so whois.ts failed closed and made no request). There is no
 * WHOIS re-offer for scam_entities, so `completed` would drop WHOIS for good.
 * A held entity is marked `failed`, which the next run's pending/failed
 * select re-picks.
 *
 * Go-red (2026-09-28, each reverted → failed → restored):
 *   - disable both `whoisHeldForRetry(whois)` throws (enrichDomain and
 *     enrichEmail) → "domain: …" and "email: …" fail (status completed).
 *   - delete the `results[1] … instanceof WhoisHeldError` rethrow in
 *     enrichEmail → "email: …" fails (the held leg vanished into `{}` and the
 *     entity completed).
 */

const m = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  entity: { id: 7, entity_type: "domain", normalized_value: "x.example" },
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
  featureFlags: new Proxy({}, { get: (_t, k) => k === "entityEnrichment" }),
}));
vi.mock("../../ssl", () => ({
  checkSSL: async () => ({ valid: true, issuer: "LE", daysRemaining: 30 }),
}));
vi.mock("../../local-intel", () => ({
  analyzeDomain: async () => ({ ok: true }),
  analyzeEmail: async () => ({ ok: true }),
  analyzePhone: async () => ({}),
  analyzeIP: async () => ({}),
  analyzeURL: async () => ({}),
}));
vi.mock("../../whois", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../whois")>()),
  lookupWhois: m.lookupWhois,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["from", "select", "eq", "in", "gte", "order", "limit"]) {
      chain[k] = () => chain;
    }
    chain.update = (u: Record<string, unknown>) => {
      m.updates.push(u);
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [m.entity], error: null }).then(resolve);
    return chain;
  },
}));

import { entityEnrichmentFanOut } from "../entity-enrichment";

const BASE = {
  registrar: null,
  registrarAbuseEmail: null,
  registrantCountry: null,
  createdDate: null,
  expiresDate: null,
  nameServers: [],
  isPrivate: false,
  raw: null,
};
const HELD = {
  ...BASE,
  deferral: {
    reason: "quota_unknown" as const,
    retryAfter: "2026-09-29T09:00:00.000Z",
  },
};
const SERVED = { ...BASE, registrar: "R" };

const run = () =>
  (entityEnrichmentFanOut as unknown as (ctx: unknown) => Promise<unknown>)({
    step: { run: async (_n: string, fn: () => unknown) => fn() },
  });

/** The per-entity result write (the last update carrying a terminal status). */
const finalStatus = () =>
  m.updates
    .map((u) => u.enrichment_status)
    .filter((s) => s === "completed" || s === "failed")
    .at(-1);

beforeEach(() => {
  m.updates.length = 0;
  m.lookupWhois.mockReset();
});

describe("entity-enrichment — held WHOIS (PR-F)", () => {
  it("domain: a HELD lookup marks the entity failed (re-selected next run), with a reason", async () => {
    m.entity = { id: 7, entity_type: "domain", normalized_value: "x.example" };
    m.lookupWhois.mockResolvedValue(HELD);
    await run();
    expect(finalStatus()).toBe("failed");
    // The last `failed` write is the per-entity result (the first is the reap).
    expect(
      m.updates.filter((u) => u.enrichment_status === "failed").at(-1)
        ?.enrichment_error,
    ).toMatch(/whois_held/);
  });

  it("email: a HELD lookup marks the entity failed too", async () => {
    m.entity = { id: 8, entity_type: "email", normalized_value: "a@x.example" };
    m.lookupWhois.mockResolvedValue(HELD);
    await run();
    expect(finalStatus()).toBe("failed");
  });

  it("a served lookup still completes the entity", async () => {
    m.entity = { id: 9, entity_type: "domain", normalized_value: "x.example" };
    m.lookupWhois.mockResolvedValue(SERVED);
    await run();
    expect(finalStatus()).toBe("completed");
  });
});
