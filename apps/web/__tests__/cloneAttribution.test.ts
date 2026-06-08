import { describe, expect, it } from "vitest";
import { shapeAttribution } from "@/lib/clone-watch/enrich-attribution";

const AT = "2026-06-07T13:30:00.000Z";

describe("shapeAttribution", () => {
  it("maps whois + ct + ip_rep + hosting into the dossier", () => {
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
      },
      ct: {
        certificateCount: 3,
        certificates: [
          { issuerName: "Let's Encrypt", notBefore: "", notAfter: "", commonName: "nab-login.shop" },
        ],
        uniqueSubdomains: ["nab-login.shop", "nab-secure.shop", "*.nab-login.shop"],
        hasWildcard: true,
        oldestCertDate: null,
        newestCertDate: null,
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

    expect(d.whois).toMatchObject({ registrar: "NameCheap", registrarAbuseEmail: "abuse@namecheap.com", registrantCountry: "RU", createdDate: "2026-06-01" });
    expect(d.ip_rep).toMatchObject({ abuseConfidenceScore: 88, isp: "Evil Hosting" });
    expect(d.hosting).toEqual({ ip: "203.0.113.7", country: "RU", asn: "AS12345" });
    expect(d.ct?.issuer).toBe("Let's Encrypt");
    expect(d.ct?.hasWildcard).toBe(true);
    // siblings exclude the clone domain itself (incl. its wildcard form).
    expect(d.ct?.siblings).toEqual(["nab-secure.shop"]);
    expect(d.enriched_at).toBe(AT);
  });

  it("collapses missing sections to null and backfills hosting country from geo", () => {
    const d = shapeAttribution({
      domain: "x.shop",
      whois: null,
      ct: null,
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
