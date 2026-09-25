import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above module-level consts, so the shared state
// they close over must be created via vi.hoisted (also hoisted).
const { flags, lookupRdapOutcome, lookupWhois } = vi.hoisted(() => ({
  flags: { rdapLookup: false },
  lookupRdapOutcome: vi.fn(),
  lookupWhois: vi.fn(),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));
vi.mock("../rdap", () => ({ lookupRdapOutcome }));
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
    lookupRdapOutcome.mockReset();
    lookupWhois.mockReset();
  });

  it("flag OFF → whoisjson only, RDAP never called", async () => {
    lookupWhois.mockResolvedValue(WHOIS);
    const r = await lookupDomainRegistration("x.shop");
    expect(lookupRdapOutcome).not.toHaveBeenCalled();
    expect(r.source).toBe("whoisjson");
    expect(r.registrar).toBe("GoDaddy");
    // whoisjson has no statuses/IANA id, but the abuse email maps through.
    expect(r.statuses).toEqual([]);
    expect(r.abuseContact).toEqual({ email: "abuse@godaddy.com", phone: null });
  });

  it("flag ON + RDAP has data → whoisjson NOT called (quota preserved)", async () => {
    flags.rdapLookup = true;
    lookupRdapOutcome.mockResolvedValue({ result: RDAP, outcome: "found" });
    const r = await lookupDomainRegistration("x.shop");
    expect(lookupWhois).not.toHaveBeenCalled();
    expect(r.source).toBe("rdap");
    expect(r.statuses).toEqual(["client hold"]);
    expect(r.registrarIanaId).toBe("1068");
  });

  // 2026-09-26: a definitive RDAP answer is final — whoisjson (1,000/month) is
  // spent only when RDAP cannot answer (no server for the TLD, or an error).
  it("flag ON + RDAP record without registrar → keeps RDAP, whoisjson NOT called", async () => {
    flags.rdapLookup = true;
    lookupRdapOutcome.mockResolvedValue({
      result: { ...RDAP, registrar: null, createdDate: null },
      outcome: "found",
    });
    const r = await lookupDomainRegistration("x.shop");
    expect(lookupWhois).not.toHaveBeenCalled();
    expect(r.source).toBe("rdap");
    expect(r.statuses).toEqual(["client hold"]);
  });

  it.each(["error", "no_server", "not_found"] as const)(
    "flag ON + RDAP %s → falls back to whoisjson",
    async (outcome) => {
      flags.rdapLookup = true;
      lookupRdapOutcome.mockResolvedValue({ result: null, outcome });
      lookupWhois.mockResolvedValue(WHOIS);
      const r = await lookupDomainRegistration("x.ru");
      expect(lookupWhois).toHaveBeenCalledOnce();
      expect(r.source).toBe("whoisjson");
    },
  );

  it("passes the caller's priority through to the whoisjson guard", async () => {
    flags.rdapLookup = true;
    lookupRdapOutcome.mockResolvedValue({ result: null, outcome: "error" });
    lookupWhois.mockResolvedValue(WHOIS);
    await lookupDomainRegistration("x.shop", { priority: "batch" });
    expect(lookupWhois).toHaveBeenCalledWith("x.shop", { priority: "batch" });
  });

  it("flag ON + lookup throws → treated as error → whoisjson", async () => {
    flags.rdapLookup = true;
    lookupRdapOutcome.mockRejectedValue(new Error("boom"));
    lookupWhois.mockResolvedValue(WHOIS);
    expect((await lookupDomainRegistration("x.shop")).source).toBe("whoisjson");
  });

  it("both empty → source 'none'", async () => {
    flags.rdapLookup = true;
    lookupRdapOutcome.mockResolvedValue({ result: null, outcome: "error" });
    lookupWhois.mockResolvedValue(null);
    const r = await lookupDomainRegistration("x.shop");
    expect(r.source).toBe("none");
    expect(r.registrar).toBeNull();
  });
});
