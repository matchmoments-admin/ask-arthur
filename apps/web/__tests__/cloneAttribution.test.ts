import { describe, expect, it } from "vitest";
import { shapeAttribution } from "@/lib/clone-watch/enrich-attribution";

const AT = "2026-06-07T13:30:00.000Z";

describe("shapeAttribution", () => {
  it("maps whois + ip_rep + hosting into the dossier", () => {
    const d = shapeAttribution({
      domain: "nab-login.shop",
      whois: {
        registrar: "NameCheap",
        registrarAbuseEmail: "abuse@namecheap.com",
        registrantCountry: "RU",
        createdDate: "2026-06-01",
        expiresDate: "2027-06-01",
        nameServers: ["ns1.x.com", "ns2.x.com"],
        isPrivate: true,
        raw: null,
        statuses: ["client hold"],
        registrarIanaId: "1068",
        abuseContact: { email: "abuse@namecheap.com", phone: null },
        source: "rdap",
      },
      ipRep: {
        abuseConfidenceScore: 88,
        totalReports: 12,
        lastReportedAt: null,
        isp: "Evil Hosting",
        usageType: "Data Center/Web Hosting/Transit",
        domain: null,
        isWhitelisted: false,
      },
      geo: null,
      hosting: { ip: "203.0.113.7", country: "RU", asn: "AS12345" },
      enrichedAt: AT,
    });

    expect(d.whois).toMatchObject({
      registrar: "NameCheap",
      registrarAbuseEmail: "abuse@namecheap.com",
      registrantCountry: "RU",
      createdDate: "2026-06-01",
      statuses: ["client hold"],
      registrarIanaId: "1068",
      source: "rdap",
    });
    expect(d.ip_rep).toMatchObject({ abuseConfidenceScore: 88, isp: "Evil Hosting" });
    expect(d.hosting).toEqual({ ip: "203.0.113.7", country: "RU", asn: "AS12345" });
    // The Certificate-Transparency leg was removed 2026-09-27 (crt.sh is dead
    // per ADR-0016 and every call spent its full 5s timeout). A new dossier must
    // never carry a ct section again — reinstating the leg fails here. The FIELD
    // survives on the type because 116 alerts enriched before the removal still
    // hold one, and their campaign_key hashes ct.issuer.
    expect(d.ct).toBeNull();
    expect(shapeAttribution).toHaveLength(1); // one args object, no ct param
    expect(d.enriched_at).toBe(AT);
  });

  it("collapses missing sections to null and backfills hosting country from geo", () => {
    const d = shapeAttribution({
      domain: "x.shop",
      whois: null,
      ipRep: null,
      geo: { region: "Moscow", countryCode: "RU" },
      hosting: { ip: "203.0.113.7", country: null, asn: null },
      enrichedAt: AT,
    });
    expect(d.whois).toBeNull();
    expect(d.ct).toBeNull();
    expect(d.ip_rep).toBeNull();
    // urlscan gave no country → geo backfills it.
    expect(d.hosting.country).toBe("RU");
  });
});
