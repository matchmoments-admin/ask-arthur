import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { geolocateIP } from "@askarthur/scam-engine/geolocate";
import { createServiceClient } from "@askarthur/supabase/server";
import { lookupPhoneNumber } from "@/lib/twilioLookup";
import { validateApiKey } from "@/lib/apiAuth";

import { POST } from "@/app/api/scam-contacts/report/route";
import { GET } from "@/app/api/scam-contacts/lookup/route";

// Flip the gating flag on without touching real env (preserve other flags).
vi.mock("@askarthur/utils/feature-flags", async (orig) => {
  const actual = await orig<typeof import("@askarthur/utils/feature-flags")>();
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, scamContactReporting: true },
  };
});
vi.mock("@askarthur/utils/rate-limit", () => ({ checkFormRateLimit: vi.fn() }));
vi.mock("@askarthur/scam-engine/geolocate", () => ({ geolocateIP: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/twilioLookup", () => ({ lookupPhoneNumber: vi.fn() }));
vi.mock("@/lib/apiAuth", () => ({ validateApiKey: vi.fn() }));

const flags = featureFlags as { scamContactReporting: boolean };

/**
 * Chainable Supabase stub. `rpcByName` resolves rpc(name,...) per RPC name;
 * `maybeSingle` resolves the select chain. Tracks calls via the returned `rpc`.
 */
function makeSupabase(opts: {
  rpcByName?: Record<string, { data: unknown; error: unknown }>;
  maybeSingle?: { data: unknown; error: unknown };
}) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi
    .fn()
    .mockResolvedValue(opts.maybeSingle ?? { data: null, error: null });
  const rpc = vi.fn((name: string, _args?: Record<string, unknown>) =>
    Promise.resolve(opts.rpcByName?.[name] ?? { data: null, error: null }),
  );
  return { client: { from: vi.fn(() => chain), rpc }, rpc };
}

function useSupabase(client: unknown) {
  vi.mocked(createServiceClient).mockReturnValue(
    client as ReturnType<typeof createServiceClient>,
  );
}

function postReq(body: unknown) {
  return new NextRequest("https://askarthur.au/api/scam-contacts/report", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getReq(q: string) {
  return new NextRequest(
    `https://askarthur.au/api/scam-contacts/lookup?q=${encodeURIComponent(q)}`,
    { headers: { "x-real-ip": "203.0.113.7" } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.scamContactReporting = true;
  vi.mocked(checkFormRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 5,
    resetAt: null,
  });
  vi.mocked(geolocateIP).mockResolvedValue({ region: "NSW", countryCode: "AU" });
  vi.mocked(validateApiKey).mockResolvedValue({ valid: false });
});

describe("POST /api/scam-contacts/report — re-wired to scam_entities", () => {
  it("404s when the flag is off", async () => {
    flags.scamContactReporting = false;
    const res = await POST(postReq({ contacts: [{ type: "email", value: "a@b.com" }] }));
    expect(res.status).toBe(404);
  });

  it("429s when rate-limited", async () => {
    vi.mocked(checkFormRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      message: "slow down",
    });
    const res = await POST(postReq({ contacts: [{ type: "email", value: "a@b.com" }] }));
    expect(res.status).toBe(429);
  });

  it("reports an email via report_scam_entity + email_domain enrichment, preserving response shape", async () => {
    const { client, rpc } = makeSupabase({
      rpcByName: {
        report_scam_entity: {
          data: [{ entity_id: 42, is_new: true, report_count: 3 }],
          error: null,
        },
        merge_entity_enrichment_data: { data: null, error: null },
      },
    });
    useSupabase(client);

    const res = await POST(
      postReq({ contacts: [{ type: "email", value: "Scammer@Evil.com" }], analysisId: 99 }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      reported: true,
      contacts: [{ value: "scammer@evil.com", reportCount: 3 }],
    });

    // report_scam_entity called with the entity + country + report link
    const reportCall = rpc.mock.calls.find((c) => c[0] === "report_scam_entity");
    expect(reportCall?.[1]).toMatchObject({
      p_entity_type: "email",
      p_normalized_value: "scammer@evil.com",
      p_country_code: "AU",
      p_report_id: 99,
      p_role: "sender",
    });
    // new email → email_domain enrichment merged
    const mergeCall = rpc.mock.calls.find((c) => c[0] === "merge_entity_enrichment_data");
    expect(mergeCall?.[1]).toMatchObject({ p_entity_id: 42, p_key: "email_domain", p_value: "evil.com" });
  });

  it("enriches a NEW phone with Twilio and surfaces carrier/lineType", async () => {
    const { client, rpc } = makeSupabase({
      rpcByName: {
        report_scam_entity: {
          data: [{ entity_id: 7, is_new: true, report_count: 1 }],
          error: null,
        },
        merge_entity_enrichment_data: { data: null, error: null },
      },
    });
    useSupabase(client);
    vi.mocked(lookupPhoneNumber).mockResolvedValue({
      carrier: "Telstra",
      lineType: "mobile",
      isVoip: false,
      countryCode: "AU",
    } as Awaited<ReturnType<typeof lookupPhoneNumber>>);

    const res = await POST(postReq({ contacts: [{ type: "phone", value: "0412345678" }] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.contacts[0]).toMatchObject({ carrier: "Telstra", lineType: "mobile", reportCount: 1 });
    const mergeCall = rpc.mock.calls.find((c) => c[0] === "merge_entity_enrichment_data");
    expect(mergeCall?.[1]).toMatchObject({ p_entity_id: 7, p_key: "twilio" });
    expect(lookupPhoneNumber).toHaveBeenCalledOnce();
  });

  it("does NOT enrich an existing (is_new=false) phone", async () => {
    const { client } = makeSupabase({
      rpcByName: {
        report_scam_entity: {
          data: [{ entity_id: 7, is_new: false, report_count: 9 }],
          error: null,
        },
      },
    });
    useSupabase(client);
    const res = await POST(postReq({ contacts: [{ type: "phone", value: "0412345678" }] }));
    expect(res.status).toBe(200);
    expect(lookupPhoneNumber).not.toHaveBeenCalled();
  });

  it("skips Twilio enrichment for a NEW phone when feature_brakes.scam_contacts_twilio is set", async () => {
    // maybeSingle backs isFeatureBraked's feature_brakes read (the report path
    // itself only uses .rpc()), so a future paused_until brakes Twilio while the
    // entity is still reported.
    const { client } = makeSupabase({
      rpcByName: {
        report_scam_entity: {
          data: [{ entity_id: 7, is_new: true, report_count: 1 }],
          error: null,
        },
      },
      maybeSingle: {
        data: { paused_until: new Date(Date.now() + 3_600_000).toISOString() },
        error: null,
      },
    });
    useSupabase(client);
    const res = await POST(postReq({ contacts: [{ type: "phone", value: "0412345678" }] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Entity still reported, but no paid Twilio call and no carrier/lineType.
    expect(json.contacts[0]).toMatchObject({ value: "+61412345678", reportCount: 1 });
    expect(json.contacts[0].carrier).toBeUndefined();
    expect(lookupPhoneNumber).not.toHaveBeenCalled();
  });
});

describe("GET /api/scam-contacts/lookup — re-wired to scam_entities", () => {
  it("404s when the flag is off", async () => {
    flags.scamContactReporting = false;
    const res = await GET(getReq("a@b.com"));
    expect(res.status).toBe(404);
  });

  it("returns found:false when the entity is absent", async () => {
    useSupabase(makeSupabase({ maybeSingle: { data: null, error: null } }).client);
    const res = await GET(getReq("clean@example.com"));
    expect(await res.json()).toEqual({ found: false });
  });

  it("anonymous: returns threatLevel + reportCount from scam_entities", async () => {
    const { client } = makeSupabase({
      maybeSingle: {
        data: {
          entity_type: "email",
          normalized_value: "scammer@evil.com",
          report_count: 12,
          risk_score: 80,
          risk_level: "HIGH",
          country_code: "AU",
          enrichment_data: {},
          first_seen: "2026-01-01T00:00:00Z",
          last_seen: "2026-05-01T00:00:00Z",
        },
        error: null,
      },
    });
    useSupabase(client);
    const res = await GET(getReq("scammer@evil.com"));
    expect(await res.json()).toEqual({ found: true, threatLevel: "HIGH", reportCount: 12 });
    // queried the entity table by (entity_type, normalized_value)
    expect((client.from as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("scam_entities");
  });

  it("authenticated B2B: maps risk_* + enrichment_data.twilio to the full shape", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, rateLimited: false });
    const { client } = makeSupabase({
      maybeSingle: {
        data: {
          entity_type: "phone",
          normalized_value: "+61412345678",
          report_count: 5,
          risk_score: 64,
          risk_level: "MEDIUM",
          country_code: "AU",
          enrichment_data: { twilio: { carrier: "Optus", line_type: "mobile", is_voip: false } },
          first_seen: "2026-02-02T00:00:00Z",
          last_seen: "2026-05-02T00:00:00Z",
        },
        error: null,
      },
    });
    useSupabase(client);
    const res = await GET(getReq("0412345678"));
    const json = await res.json();
    expect(json).toMatchObject({
      found: true,
      contactType: "phone",
      reportCount: 5,
      confidenceScore: 64,
      confidenceLevel: "MEDIUM",
      currentCarrier: "Optus",
      lineType: "mobile",
      isVoip: false,
      countryCode: "AU",
    });
    // dropped fields are absent
    expect(json).not.toHaveProperty("uniqueReporterCount");
    expect(json).not.toHaveProperty("primaryScamType");
  });
});
