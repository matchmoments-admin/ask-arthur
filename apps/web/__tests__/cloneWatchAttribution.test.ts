import { describe, expect, it } from "vitest";

import {
  EMPTY_ATTRIBUTION,
  abuseChannels,
  readAttribution,
} from "@/lib/clone-watch/attribution";

/**
 * readAttribution is the ONE reader of shopfront_clone_alerts.attribution.
 * Fixtures are real prod shapes (2026-09-22): RDAP dossier with whois.* keys,
 * ASN sometimes a number, the legacy flat keys nothing writes any more.
 */
describe("readAttribution", () => {
  it("reads the enricher's dossier", () => {
    const v = readAttribution({
      whois: {
        source: "rdap",
        statuses: ["active"],
        registrar: "DomainRegistry.com LLC",
        createdDate: "2026-09-19",
        nameServers: ["ns1.hosting.businessidentity.llc"],
        registrarIanaId: "128",
        registrantCountry: null,
        registrarAbuseEmail: "abuse@domainregistry.com",
      },
      hosting: { ip: null, asn: 13335, country: "US" },
      ip_rep: { abuseConfidenceScore: 42 },
      au_registrant: { abnStatus: "cancelled", nameMatchesAbn: false },
      enriched_at: "2026-09-22T13:33:00Z",
    });
    expect(v.registrar).toBe("DomainRegistry.com LLC");
    expect(v.registrarAbuseEmail).toBe("abuse@domainregistry.com");
    expect(v.createdDate).toBe("2026-09-19");
    expect(v.hosting.asn).toBe("13335"); // number coerced — the #2026-06-15 .trim() crash class
    expect(v.ipAbuseScore).toBe(42);
    expect(v.auAbnStatus).toBe("cancelled");
    expect(v.auNameMatchesAbn).toBe(false);
    expect(v.source).toBe("rdap");
  });

  it("falls back to the legacy flat keys", () => {
    const v = readAttribution({ registrar: "NameCheap", registrar_abuse_email: "abuse@namecheap.com" });
    expect(v.registrar).toBe("NameCheap");
    expect(v.registrarAbuseEmail).toBe("abuse@namecheap.com");
  });

  it.each([null, undefined, "x", 3, []])("tolerates non-object jsonb (%s)", (raw) => {
    expect(readAttribution(raw)).toEqual(EMPTY_ATTRIBUTION);
  });

  it("blank strings are null, not empty recipients", () => {
    expect(readAttribution({ whois: { registrarAbuseEmail: "  " } }).registrarAbuseEmail).toBeNull();
  });
});

describe("abuseChannels", () => {
  it("registrar with no curated page falls back to ICANN", () => {
    const [ch] = abuseChannels(readAttribution({ whois: { registrar: "Gname.com Pte. Ltd." } }));
    expect(ch).toMatchObject({ kind: "registrar", email: null, url: "https://www.icann.org/compliance/complaint" });
  });

  it("no registrar, no email, non-Cloudflare ASN → no channels", () => {
    expect(abuseChannels(readAttribution({ hosting: { asn: "AS9999" } }))).toEqual([]);
  });
});
