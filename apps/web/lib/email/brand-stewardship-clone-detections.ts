import type { CloneDetections } from "@/emails/BrandStewardshipReport";

/**
 * Map the `metrics.clones` jsonb (written by report-brand-stewardship's clone
 * aggregation, snake_case) to the BrandStewardshipReport `cloneDetections`
 * prop (camelCase). Returns undefined when there are no clone detections so the
 * email section is omitted entirely. Shared by the preview + send routes so
 * both render identical content.
 */
interface StoredCloneDomain {
  domain: string;
  classification?: string | null;
  ip?: string | null;
  asn?: string | null;
  country?: string | null;
  registrar?: string | null;
  abuse_email?: string | null;
}

interface StoredClones {
  detected?: number;
  by_classification?: Record<string, number>;
  by_country?: Record<string, number>;
  by_registrar?: Record<string, number>;
  by_asn?: Record<string, number>;
  domains?: StoredCloneDomain[];
}

export function cloneDetectionsFromMetrics(
  clones: unknown,
): CloneDetections | undefined {
  const c = clones as StoredClones | null | undefined;
  if (!c || !c.detected || !Array.isArray(c.domains) || c.domains.length === 0) {
    return undefined;
  }
  return {
    detected: c.detected,
    byClassification: c.by_classification,
    byCountry: c.by_country,
    byRegistrar: c.by_registrar,
    byAsn: c.by_asn,
    domains: c.domains.map((d) => ({
      domain: d.domain,
      classification: d.classification ?? null,
      ip: d.ip ?? null,
      asn: d.asn ?? null,
      country: d.country ?? null,
      registrar: d.registrar ?? null,
      abuseEmail: d.abuse_email ?? null,
    })),
  };
}
