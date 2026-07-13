import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupWhois } from "../whois";
import { logCost } from "../cost-log";

// Telemetry is fire-and-forget; mock it so we can assert on the billable-call
// signal without touching Supabase.
vi.mock("../cost-log", () => ({ logCost: vi.fn() }));

// Real whoisjson.com response shape (verified live 2026-06-08): `registrar` is
// an OBJECT with name + abuse email, nameservers are under `nameserver`.
const WHOISJSON_SHAPE = {
  name: "stakebank.org",
  created: "2026-06-02 16:29:53",
  expires: "2027-06-02 16:29:53",
  nameserver: ["arnold.ns.cloudflare.com", "desiree.ns.cloudflare.com"],
  registrar: {
    id: "1068",
    name: "NameCheap, Inc.",
    email: "abuse@namecheap.com",
    phone: "tel:+1.9854014545",
  },
  contacts: { owner: [], admin: [], tech: [], abuse: [] },
};

describe("lookupWhois — whoisjson object shape", () => {
  beforeEach(() => {
    process.env.WHOIS_API_KEY = "test-key";
    vi.mocked(logCost).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => WHOISJSON_SHAPE,
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WHOIS_API_KEY;
  });

  it("extracts registrar name + abuse email from the registrar object", async () => {
    const r = await lookupWhois("stakebank.org");
    expect(r.registrar).toBe("NameCheap, Inc.");
    expect(r.registrarAbuseEmail).toBe("abuse@namecheap.com");
  });

  it("reads nameservers from the `nameserver` field (lowercased)", async () => {
    const r = await lookupWhois("stakebank.org");
    expect(r.nameServers).toEqual([
      "arnold.ns.cloudflare.com",
      "desiree.ns.cloudflare.com",
    ]);
  });

  it("parses the created date", async () => {
    const r = await lookupWhois("stakebank.org");
    expect(r.createdDate).toBe("2026-06-02");
  });

  it("returns the empty result (incl. registrarAbuseEmail:null) with no API key", async () => {
    delete process.env.WHOIS_API_KEY;
    const r = await lookupWhois("x.com");
    expect(r.registrar).toBeNull();
    expect(r.registrarAbuseEmail).toBeNull();
  });

  it("logs one billable cost row (whois/whoisjson, $0) per successful lookup", async () => {
    await lookupWhois("stakebank.org");
    expect(logCost).toHaveBeenCalledTimes(1);
    expect(logCost).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "whois",
        provider: "whoisjson",
        units: 1,
        estimatedCostUsd: 0,
      }),
    );
  });

  it("does NOT log cost when the API key is missing (no upstream call)", async () => {
    delete process.env.WHOIS_API_KEY;
    await lookupWhois("x.com");
    expect(logCost).not.toHaveBeenCalled();
  });

  it("does NOT log cost on a non-200 response (quota not consumed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })),
    );
    await lookupWhois("ratelimited.example");
    expect(logCost).not.toHaveBeenCalled();
  });
});
