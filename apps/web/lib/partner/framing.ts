/**
 * Partner-type framing for the partner dashboard.
 *
 * The dashboard is ONE shell; the partner type decides how the same
 * de-identified data is framed — which panels show, the scope dimension
 * (jurisdiction vs brand), the pitch copy, and co-branding. Police is the
 * first configuration, not a special case; adding a new partner (another
 * state force, a regulator, a bank) is a data-only entry here, and adding a
 * new country/state is a new `jurisdiction` value — the §9 scaling seam from
 * the NSW pilot brief.
 *
 * No PII lives here — this is presentation config only (plus the pure
 * region→state helper, which is shared with the data loader and unit-tested).
 */
import { parseStateFromRegion } from "@/lib/chart-tokens";

export type PartnerType = "police" | "regulator" | "bank" | "community" | "brand";

/** Panels the dashboard can render. Data-driven, reused across partner types. */
export type PartnerPanelKey = "regional_threat" | "reporting_funnel";

export interface PartnerFraming {
  type: PartnerType;
  /** Human label for the partner category. */
  label: string;
  /** Whether this partner cares about a geographic jurisdiction or a brand. */
  scope: "jurisdiction" | "brand";
  /** One-line pitch headline shown at the top of the dashboard. */
  headline: string;
  /** The framing pillars (what the partner *receives*, not what we do). */
  pillars: string[];
  /** Ordered panels to render for this partner type. */
  panels: PartnerPanelKey[];
  /** Governance note surfaced on the dashboard so the framing stays honest. */
  governanceNote: string;
}

export const PARTNER_FRAMING: Record<PartnerType, PartnerFraming> = {
  police: {
    type: "police",
    label: "Police / Law enforcement",
    scope: "jurisdiction",
    headline:
      "A live detect–deter–report loop: intercept before money moves, triage to the correct destination, and see anonymised regional threat data.",
    pillars: [
      "Reporting funnel — one triaged front door that pre-routes victims to the right destination, collapsing the six-destination decision tree.",
      "Deterrent — a 'check before you act' intercept at the only point loss is preventable.",
      "Regional threat data — de-identified scam trends, top scam types and impersonated brands, by jurisdiction.",
    ],
    panels: ["regional_threat", "reporting_funnel"],
    governanceNote:
      "All figures are de-identified aggregates (no PII, no scanned content). A live partnership would sit under an information-sharing agreement and the relevant state privacy act (e.g. NSW PPIPA).",
  },
  regulator: {
    type: "regulator",
    label: "Regulator",
    scope: "jurisdiction",
    headline:
      "Anonymised, jurisdiction-scoped scam intelligence to inform enforcement priorities and public warnings.",
    pillars: [
      "Regional scam trends and emerging campaign detection.",
      "Top impersonated brands and channels for targeted warnings.",
      "A reporting funnel that routes consumers to the correct authority.",
    ],
    panels: ["regional_threat", "reporting_funnel"],
    governanceNote:
      "De-identified aggregates only. Data-sharing scope is set by the partnership agreement.",
  },
  bank: {
    type: "bank",
    label: "Bank / Financial institution",
    scope: "brand",
    headline:
      "Brand-impersonation intelligence and a victim-routing funnel that gets your customers to the right place fast.",
    pillars: [
      "Impersonation-of-your-brand trends across channels.",
      "A funnel that routes victims to your fraud line first when money moved.",
      "Anonymised regional context.",
    ],
    panels: ["regional_threat", "reporting_funnel"],
    governanceNote:
      "De-identified aggregates only. Brand-scoped views require a data-sharing agreement.",
  },
  community: {
    type: "community",
    label: "Community / Advocacy",
    scope: "jurisdiction",
    headline:
      "Local scam trends and a plain-language reporting funnel to share with the people you support.",
    pillars: [
      "Regional scam trends in plain language.",
      "A one-tap reporting funnel for the communities you serve.",
      "Co-brandable safety content.",
    ],
    panels: ["regional_threat", "reporting_funnel"],
    governanceNote: "De-identified aggregates only.",
  },
  brand: {
    type: "brand",
    label: "Brand / Business",
    scope: "brand",
    headline:
      "See how your brand is being impersonated and how victims are being routed.",
    pillars: [
      "Impersonation-of-your-brand trends.",
      "Victim-routing funnel outcomes.",
      "Regional context.",
    ],
    panels: ["regional_threat", "reporting_funnel"],
    governanceNote: "De-identified aggregates only.",
  },
};

export function resolvePartnerType(raw: string | null | undefined): PartnerType {
  const t = (raw ?? "").toLowerCase();
  return (t in PARTNER_FRAMING ? t : "police") as PartnerType;
}

/** AU state codes accepted as a jurisdiction filter (matches AU_STATE_MAP). */
export const AU_JURISDICTIONS = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;
export type AuJurisdiction = (typeof AU_JURISDICTIONS)[number];

export function resolveJurisdiction(raw: string | null | undefined): AuJurisdiction | null {
  const j = (raw ?? "").toUpperCase();
  return (AU_JURISDICTIONS as readonly string[]).includes(j) ? (j as AuJurisdiction) : null;
}

const AU_CODE_SET = new Set<string>(AU_JURISDICTIONS);

/**
 * Map a region string to an AU state code, tolerant of BOTH stored forms —
 * real `scam_reports.region` values mix full names ("Sydney, New South Wales")
 * and codes ("Sydney, NSW"). `parseStateFromRegion` only handles full names,
 * so without the code fallback the largest buckets are silently dropped
 * (measured: NSW undercounted 4× on prod data). Returns null for non-AU or
 * country-only regions ("AU", "KR", …).
 */
export function regionToStateCode(region: string | null): string | null {
  if (!region) return null;
  const byFullName = parseStateFromRegion(region);
  if (byFullName) return byFullName;
  const last = region.split(", ").pop()?.trim().toUpperCase() ?? "";
  return AU_CODE_SET.has(last) ? last : null;
}
