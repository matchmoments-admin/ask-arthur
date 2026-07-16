import { canonicalRegistrar } from "./registrar-canonical";

/**
 * Roll a cohort of clone alerts up into COORDINATED CAMPAIGNS by their
 * campaign_key (v235) — "N of these lookalikes trace to M coordinated actors".
 * This is the brand-protection headline the campaign-fingerprint feature was
 * built to produce; without a reader the key was orphaned write-cost.
 *
 * A "campaign" is a campaign_key shared by >=2 alerts. The `insufficient`
 * sentinel and null keys (too little attribution to cluster) are excluded.
 * Pure + deterministic so the report card, LinkedIn export, and the masked
 * brand-exposure teaser all read one implementation.
 */
export interface CampaignRow {
  /** Short fingerprint (opaque to brands — never a domain list). */
  key: string;
  domainCount: number;
  weaponisedCount: number;
  /** Canonical registrar of the campaign (modal), for the "one registrar,
   *  N domains" story. null when unknown/redacted across the cluster. */
  registrar: string | null;
}

export interface CampaignSummary {
  /** Number of >=2-domain campaigns. */
  campaignCount: number;
  /** Domains that belong to any >=2-domain campaign. */
  clusteredDomains: number;
  /** Size of the single largest campaign. */
  largestCampaign: number;
  /** Top campaigns (largest first), capped — safe to expose (no domain names). */
  top: CampaignRow[];
}

export interface CampaignInput {
  campaign_key?: string | null;
  weaponised_at?: string | null;
  attribution?: { whois?: { registrar?: string | null } | null } | null;
}

const TOP_CAP = 5;

export function summariseCampaigns(
  rows: CampaignInput[],
  topCap = TOP_CAP,
): CampaignSummary {
  const groups = new Map<
    string,
    { count: number; weaponised: number; registrars: Map<string, number> }
  >();

  for (const r of rows) {
    const key = r.campaign_key;
    if (!key || key === "insufficient") continue;
    let g = groups.get(key);
    if (!g) {
      g = { count: 0, weaponised: 0, registrars: new Map() };
      groups.set(key, g);
    }
    g.count += 1;
    if (r.weaponised_at) g.weaponised += 1;
    const reg = canonicalRegistrar(r.attribution?.whois?.registrar ?? null);
    if (reg) g.registrars.set(reg, (g.registrars.get(reg) ?? 0) + 1);
  }

  const campaigns: CampaignRow[] = [];
  for (const [key, g] of groups) {
    if (g.count < 2) continue; // a campaign needs >=2 domains
    // Modal registrar across the cluster.
    let registrar: string | null = null;
    let best = 0;
    for (const [reg, n] of g.registrars) {
      if (n > best) {
        best = n;
        registrar = reg;
      }
    }
    campaigns.push({
      key,
      domainCount: g.count,
      weaponisedCount: g.weaponised,
      registrar,
    });
  }

  campaigns.sort((a, b) => b.domainCount - a.domainCount || b.weaponisedCount - a.weaponisedCount);

  return {
    campaignCount: campaigns.length,
    clusteredDomains: campaigns.reduce((s, c) => s + c.domainCount, 0),
    largestCampaign: campaigns[0]?.domainCount ?? 0,
    top: campaigns.slice(0, topCap),
  };
}
