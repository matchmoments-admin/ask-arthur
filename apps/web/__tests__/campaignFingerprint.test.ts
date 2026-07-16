import { describe, expect, it } from "vitest";
import { computeCampaignKey } from "@/lib/clone-watch/campaign-fingerprint";

describe("computeCampaignKey", () => {
  const A = {
    registrar: "NameCheap, Inc.",
    nameServers: ["dns1.registrar-servers.com", "dns2.registrar-servers.com"],
    asn: "AS13335",
    ctIssuer: "Let's Encrypt",
  };

  it("is deterministic for the same inputs", () => {
    expect(computeCampaignKey(A)).toBe(computeCampaignKey(A));
    expect(computeCampaignKey(A)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("folds registrar spelling variants to the same key (via canonicalRegistrar)", () => {
    const k1 = computeCampaignKey({ ...A, registrar: "NameCheap, Inc." });
    const k2 = computeCampaignKey({ ...A, registrar: "NAMECHEAP INC" });
    expect(k1).toBe(k2);
  });

  it("collapses nameservers to their registrable roots (order-independent)", () => {
    const k1 = computeCampaignKey({
      ...A,
      nameServers: ["ns1.cloudflare.com", "ns2.cloudflare.com"],
    });
    const k2 = computeCampaignKey({
      ...A,
      nameServers: ["ns5.cloudflare.com", "ns9.cloudflare.com"],
    });
    expect(k1).toBe(k2); // same NS operator → same contribution
  });

  it("different actor infrastructure → different key", () => {
    const other = computeCampaignKey({
      registrar: "GoDaddy",
      nameServers: ["ns1.godaddy.com"],
      asn: "AS26496",
      ctIssuer: "DigiCert",
    });
    expect(other).not.toBe(computeCampaignKey(A));
  });

  it("returns null when fewer than 2 components are present", () => {
    expect(computeCampaignKey({ registrar: "NameCheap", nameServers: [], asn: null, ctIssuer: null })).toBeNull();
    expect(computeCampaignKey({ registrar: null, nameServers: null, asn: null, ctIssuer: null })).toBeNull();
    // registrar + asn = 2 components → not null
    expect(computeCampaignKey({ registrar: "NameCheap", nameServers: null, asn: "AS1", ctIssuer: null })).not.toBeNull();
  });

  it("handles 2-level ccTLD nameserver roots (x.com.au)", () => {
    const k1 = computeCampaignKey({ ...A, nameServers: ["ns1.host.com.au"] });
    const k2 = computeCampaignKey({ ...A, nameServers: ["ns2.host.com.au"] });
    expect(k1).toBe(k2);
  });
});
