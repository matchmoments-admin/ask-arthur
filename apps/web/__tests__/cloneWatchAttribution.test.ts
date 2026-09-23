import { describe, expect, it } from "vitest";

import {
  EMPTY_ATTRIBUTION,
  abuseChannels,
  attributionRiskInputs,
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

// v320 twin rule (project_clone_to_platform_entity): a createdDate more than a
// year before the alert's first_seen_at is the PARENT zone's date — prod
// appley.eu.cc reported 1997 (eu.cc) — so it reads as unknown, or the
// weaponisation-risk scorer credits a days-old squat with a 29-year-old domain.
describe("readAttribution — implausible createdDate", () => {
  const raw = { whois: { createdDate: "1997-05-01" } };
  it("is unknown when >1 year before first_seen_at", () => {
    expect(readAttribution(raw, { firstSeenAt: "2026-09-01T00:00:00Z" }).createdDate).toBeNull();
    expect(
      attributionRiskInputs(raw, { firstSeenAt: "2026-09-01T00:00:00Z" }).whoisCreatedDate,
    ).toBeNull();
  });
  it("is kept inside the year, and when first_seen_at is unknown", () => {
    const recent = { whois: { createdDate: "2026-08-30" } };
    expect(readAttribution(recent, { firstSeenAt: "2026-09-01T00:00:00Z" }).createdDate).toBe(
      "2026-08-30",
    );
    expect(readAttribution(raw).createdDate).toBe("1997-05-01");
    expect(readAttribution(raw, { firstSeenAt: null }).createdDate).toBe("1997-05-01");
  });
  it("uses the same calendar-year cut as the SQL twin", () => {
    // (first_seen_at - interval '1 year')::date = 2025-09-01
    expect(readAttribution({ whois: { createdDate: "2025-09-01" } }, { firstSeenAt: "2026-09-01T10:00:00Z" }).createdDate).toBe("2025-09-01");
    expect(readAttribution({ whois: { createdDate: "2025-08-31" } }, { firstSeenAt: "2026-09-01T10:00:00Z" }).createdDate).toBeNull();
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
