import {
  lookupDomainRegistration,
  type DomainRegistration,
} from "@askarthur/scam-engine/domain-registration";
import { lookupCT, type CTLookupResult } from "@askarthur/scam-engine/ct-lookup";
import {
  checkAbuseIPDB,
  type AbuseIPDBResult,
} from "@askarthur/scam-engine/abuseipdb";
import { geolocateIP, type GeoResult } from "@askarthur/scam-engine/geolocate";
import { featureFlags } from "@askarthur/utils/feature-flags";

/**
 * Attribution dossier for a confirmed clone — what brands / police need for a
 * takedown or report. Assembled from existing scam-engine helpers (each does
 * its own caching + cost-logging + API-key gating). All fields degrade to null
 * so a missing key never blocks the rest.
 *
 * Honest scope: `hosting`/`whois.registrantCountry` are INFRASTRUCTURE country
 * (host/registrar), not the operator's location; registrant name/email is
 * redacted by privacy + the `.au` registry. CT siblings are the high-value bit:
 * other domains on the same certificate = one operator's campaign.
 */
export interface CloneAttribution {
  whois: {
    registrar: string | null;
    /** Registrar abuse-report email — the takedown contact for brands/police. */
    registrarAbuseEmail: string | null;
    registrantCountry: string | null;
    createdDate: string | null;
    nameServers: string[];
    /** EPP status codes (RDAP). clientHold/serverHold ⇒ registrar-suspended —
     *  direct takedown evidence. Empty when sourced from whoisjson. */
    statuses: string[];
    /** Registrar IANA id (RDAP) — stable registrar key for campaign grouping. */
    registrarIanaId: string | null;
    /** Where the record came from: rdap | whoisjson | none. */
    source: string;
  } | null;
  ct: {
    siblings: string[];
    hasWildcard: boolean;
    issuer: string | null;
    certificateCount: number;
  } | null;
  ip_rep: {
    abuseConfidenceScore: number;
    totalReports: number;
    isp: string | null;
    usageType: string | null;
  } | null;
  hosting: { ip: string | null; country: string | null; asn: string | null };
  enriched_at: string;
}

const MAX_SIBLINGS = 15;

/** Hosting attribution already captured by urlscan (urlscan_evidence.server). */
export interface HostingInfo {
  ip: string | null;
  country: string | null;
  asn: string | null;
}

/**
 * Pure projection of raw helper results → the stored dossier. Separated from the
 * network calls so it can be unit-tested. `null` inputs (missing key / disabled
 * flag) collapse to null sections.
 */
export function shapeAttribution(args: {
  domain: string;
  whois: DomainRegistration | null;
  ct: CTLookupResult | null;
  ipRep: AbuseIPDBResult | null;
  geo: GeoResult | null;
  hosting: HostingInfo;
  enrichedAt: string;
}): CloneAttribution {
  const { domain, whois, ct, ipRep, geo, hosting, enrichedAt } = args;

  const ctSection = ct
    ? {
        // Other names on the cert, excluding the clone domain itself.
        siblings: ct.uniqueSubdomains
          .filter((d) => d.replace(/^\*\./, "") !== domain)
          .slice(0, MAX_SIBLINGS),
        hasWildcard: ct.hasWildcard,
        issuer: ct.certificates[0]?.issuerName ?? null,
        certificateCount: ct.certificateCount,
      }
    : null;

  return {
    whois: whois
      ? {
          registrar: whois.registrar,
          registrarAbuseEmail: whois.registrarAbuseEmail ?? null,
          registrantCountry: whois.registrantCountry,
          createdDate: whois.createdDate,
          nameServers: whois.nameServers ?? [],
          statuses: whois.statuses ?? [],
          registrarIanaId: whois.registrarIanaId ?? null,
          source: whois.source ?? "whoisjson",
        }
      : null,
    ct: ctSection,
    ip_rep: ipRep
      ? {
          abuseConfidenceScore: ipRep.abuseConfidenceScore,
          totalReports: ipRep.totalReports,
          isp: ipRep.isp,
          usageType: ipRep.usageType,
        }
      : null,
    // urlscan gives hosting country directly; geolocate only backfills it.
    hosting: {
      ip: hosting.ip,
      country: hosting.country ?? geo?.countryCode ?? null,
      asn: hosting.asn,
    },
    enriched_at: enrichedAt,
  };
}

/**
 * Enrich one confirmed clone. Runs the helper calls concurrently; CT + AbuseIPDB
 * are gated by their feature flags (matching entity-enrichment.ts). geolocateIP
 * only fires when urlscan didn't already give us a hosting country.
 */
export async function enrichCloneAttribution(
  domain: string,
  hosting: HostingInfo,
  now: Date = new Date(),
): Promise<CloneAttribution> {
  const [whois, ct, ipRep, geo] = await Promise.all([
    lookupDomainRegistration(domain).catch(() => null),
    featureFlags.ctLookup ? lookupCT(domain).catch(() => null) : null,
    hosting.ip && featureFlags.abuseIPDB
      ? checkAbuseIPDB(hosting.ip).catch(() => null)
      : null,
    hosting.ip && !hosting.country
      ? geolocateIP(hosting.ip).catch(() => null)
      : null,
  ]);

  return shapeAttribution({
    domain,
    whois,
    ct,
    ipRep,
    geo,
    hosting,
    enrichedAt: now.toISOString(),
  });
}
