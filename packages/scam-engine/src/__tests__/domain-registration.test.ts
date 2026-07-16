import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above module-level consts, so the shared state
// they close over must be created via vi.hoisted (also hoisted).
const { flags, lookupRdap, lookupWhois } = vi.hoisted(() => ({
  flags: { rdapLookup: false },
  lookupRdap: vi.fn(),
  lookupWhois: vi.fn(),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));
vi.mock("../rdap", () => ({ lookupRdap }));
vi.mock("../whois", () => ({ lookupWhois }));

import { lookupDomainRegistration } from "../domain-registration";

const WHOIS = {
  registrar: "GoDaddy",
  registrarAbuseEmail: "abuse@godaddy.com",
  registrantCountry: null,
  createdDate: "2026-01-01",
  expiresDate: "2027-01-01",
  nameServers: ["ns1.gd.com"],
  isPrivate: false,
  raw: null,
};

const RDAP = {
  registrar: "NameCheap",
  registrarIanaId: "1068",
  abuseContact: { email: "abuse@namecheap.com", phone: null },
  registrantCountry: null,
  createdDate: "2026-06-01",
  expiresDate: "2027-06-01",
  nameServers: ["ns1.evil.com"],
  statuses: ["client hold"],
  isPrivate: false,
  source: "rdap" as const,
};

describe("lookupDomainRegistration", () => {
  beforeEach(() => {
    flags.rdapLookup = false;
    lookupRdap.mockReset();
    lookupWhois.mockReset();
  });

  it("flag OFF → whoisjson only, RDAP never called", async () => {
    lookupWhois.mockResolvedValue(WHOIS);
    const r = await lookupDomainRegistration("x.shop");
    expect(lookupRdap).not.toHaveBeenCalled();
    expect(r.source).toBe("whoisjson");
    expect(r.registrar).toBe("GoDaddy");
    // whoisjson has no statuses/IANA id, but the abuse email maps through.
    expect(r.statuses).toEqual([]);
    expect(r.abuseContact).toEqual({ email: "abuse@godaddy.com", phone: null });
  });

  it("flag ON + RDAP has data → whoisjson NOT called (quota preserved)", async () => {
    flags.rdapLookup = true;
    lookupRdap.mockResolvedValue(RDAP);
    const r = await lookupDomainRegistration("x.shop");
    expect(lookupWhois).not.toHaveBeenCalled();
    expect(r.source).toBe("rdap");
    expect(r.statuses).toEqual(["client hold"]);
    expect(r.registrarIanaId).toBe("1068");
  });

  it("flag ON + RDAP empty → falls back to whoisjson", async () => {
    flags.rdapLookup = true;
    lookupRdap.mockResolvedValue({ ...RDAP, registrar: null, createdDate: null });
    lookupWhois.mockResolvedValue(WHOIS);
    const r = await lookupDomainRegistration("x.shop");
    expect(lookupWhois).toHaveBeenCalledOnce();
    expect(r.source).toBe("whoisjson");
  });

  it("flag ON + RDAP null (404/error) → falls back to whoisjson", async () => {
    flags.rdapLookup = true;
    lookupRdap.mockResolvedValue(null);
    lookupWhois.mockResolvedValue(WHOIS);
    const r = await lookupDomainRegistration("x.shop");
    expect(r.source).toBe("whoisjson");
  });

  it("both empty → source 'none'", async () => {
    flags.rdapLookup = true;
    lookupRdap.mockResolvedValue(null);
    lookupWhois.mockResolvedValue(null);
    const r = await lookupDomainRegistration("x.shop");
    expect(r.source).toBe("none");
    expect(r.registrar).toBeNull();
  });
});
