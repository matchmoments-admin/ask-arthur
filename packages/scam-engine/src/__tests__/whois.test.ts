import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupWhois } from "../whois";

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
});
