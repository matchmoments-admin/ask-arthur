// Fraud Analyst dashboard data queries — server-side only

import { createServiceClient } from "@askarthur/supabase/server";

export interface ThreatItem {
  id: string;
  entity_type: string;
  normalized_value: string;
  risk_level: string;
  risk_score: number;
  report_count: number;
  first_seen: string;
  last_seen: string;
}

export interface ClusterSummary {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  risk_level: string;
  created_at: string;
}

export interface ThreatBreakdownItem {
  entity_type: string;
  risk_level: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Demo data — realistic for sales demos
// ---------------------------------------------------------------------------

const DEMO_THREATS: ThreatItem[] = [
  {
    id: "t-001",
    entity_type: "url",
    normalized_value: "https://myg0v-au.com/verify-identity",
    risk_level: "CRITICAL",
    risk_score: 97,
    report_count: 142,
    first_seen: new Date(Date.now() - 2 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "t-002",
    entity_type: "phone",
    normalized_value: "+61 2 8007 4392",
    risk_level: "HIGH",
    risk_score: 89,
    report_count: 87,
    first_seen: new Date(Date.now() - 5 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: "t-003",
    entity_type: "email",
    normalized_value: "support@ato-refund-au.com",
    risk_level: "CRITICAL",
    risk_score: 95,
    report_count: 204,
    first_seen: new Date(Date.now() - 7 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "t-004",
    entity_type: "domain",
    normalized_value: "commbank-secure-login.xyz",
    risk_level: "HIGH",
    risk_score: 92,
    report_count: 63,
    first_seen: new Date(Date.now() - 3 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 5400000).toISOString(),
  },
  {
    id: "t-005",
    entity_type: "url",
    normalized_value: "https://aus-post-tracking.info/parcel",
    risk_level: "HIGH",
    risk_score: 88,
    report_count: 51,
    first_seen: new Date(Date.now() - 4 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 10800000).toISOString(),
  },
  {
    id: "t-006",
    entity_type: "phone",
    normalized_value: "+61 3 9001 7721",
    risk_level: "MEDIUM",
    risk_score: 64,
    report_count: 28,
    first_seen: new Date(Date.now() - 10 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 21600000).toISOString(),
  },
  {
    id: "t-007",
    entity_type: "ip",
    normalized_value: "185.243.218.47",
    risk_level: "HIGH",
    risk_score: 85,
    report_count: 37,
    first_seen: new Date(Date.now() - 6 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 14400000).toISOString(),
  },
  {
    id: "t-008",
    entity_type: "email",
    normalized_value: "noreply@medicare-benefits.net",
    risk_level: "CRITICAL",
    risk_score: 96,
    report_count: 178,
    first_seen: new Date(Date.now() - 1 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: "t-009",
    entity_type: "domain",
    normalized_value: "westpac-online-verify.com",
    risk_level: "HIGH",
    risk_score: 91,
    report_count: 72,
    first_seen: new Date(Date.now() - 8 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 43200000).toISOString(),
  },
  {
    id: "t-010",
    entity_type: "url",
    normalized_value: "https://centrelink-payment.co/claim",
    risk_level: "MEDIUM",
    risk_score: 71,
    report_count: 19,
    first_seen: new Date(Date.now() - 12 * 86400000).toISOString(),
    last_seen: new Date(Date.now() - 86400000).toISOString(),
  },
];

const DEMO_CLUSTERS: ClusterSummary[] = [
  {
    id: "c-001",
    name: "ATO Impersonation Ring",
    description: "Coordinated phishing campaign targeting tax refund season via SMS and email",
    member_count: 34,
    risk_level: "CRITICAL",
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: "c-002",
    name: "Banking Credential Harvest",
    description: "Fake login pages targeting CommBank, Westpac and ANZ customers",
    member_count: 21,
    risk_level: "HIGH",
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: "c-003",
    name: "Medicare SMS Campaign",
    description: "Bulk SMS phishing impersonating Medicare with malicious links",
    member_count: 18,
    risk_level: "CRITICAL",
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
  {
    id: "c-004",
    name: "Parcel Delivery Scam Network",
    description: "Fake Australia Post and DHL tracking pages collecting payment details",
    member_count: 12,
    risk_level: "HIGH",
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
];

const DEMO_BREAKDOWN: ThreatBreakdownItem[] = [
  { entity_type: "url", risk_level: "CRITICAL", count: 47 },
  { entity_type: "url", risk_level: "HIGH", count: 82 },
  { entity_type: "url", risk_level: "MEDIUM", count: 34 },
  { entity_type: "phone", risk_level: "CRITICAL", count: 12 },
  { entity_type: "phone", risk_level: "HIGH", count: 38 },
  { entity_type: "phone", risk_level: "MEDIUM", count: 21 },
  { entity_type: "email", risk_level: "CRITICAL", count: 56 },
  { entity_type: "email", risk_level: "HIGH", count: 41 },
  { entity_type: "email", risk_level: "MEDIUM", count: 15 },
  { entity_type: "domain", risk_level: "CRITICAL", count: 28 },
  { entity_type: "domain", risk_level: "HIGH", count: 53 },
  { entity_type: "domain", risk_level: "MEDIUM", count: 18 },
  { entity_type: "ip", risk_level: "HIGH", count: 23 },
  { entity_type: "ip", risk_level: "MEDIUM", count: 9 },
];

// ---------------------------------------------------------------------------
// Data functions
// ---------------------------------------------------------------------------

export async function getOrgThreats(
  orgId: string | null,
  days: number = 30
): Promise<ThreatItem[]> {
  if (!orgId) return DEMO_THREATS;

  const supabase = createServiceClient();
  if (!supabase) return DEMO_THREATS;

  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data, error } = await supabase
    .from("scam_entities")
    .select(
      `
      id,
      entity_type,
      normalized_value,
      risk_level,
      risk_score,
      report_count,
      first_seen,
      last_seen,
      report_entity_links!inner(
        scam_reports!inner(source)
      )
    `
    )
    .eq("report_entity_links.scam_reports.source", "api")
    .gte("last_seen", since)
    .order("risk_score", { ascending: false })
    .limit(50);

  if (error || !data || data.length === 0) return DEMO_THREATS;

  return data.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    entity_type: String(row.entity_type || "unknown"),
    normalized_value: String(row.normalized_value || ""),
    risk_level: String(row.risk_level || "MEDIUM"),
    risk_score: Number(row.risk_score || 0),
    report_count: Number(row.report_count || 0),
    first_seen: String(row.first_seen || new Date().toISOString()),
    last_seen: String(row.last_seen || new Date().toISOString()),
  }));
}

export async function getOrgClusters(
  orgId: string | null
): Promise<ClusterSummary[]> {
  if (!orgId) return DEMO_CLUSTERS;

  const supabase = createServiceClient();
  if (!supabase) return DEMO_CLUSTERS;

  const { data, error } = await supabase
    .from("scam_clusters")
    .select("id, name, description, member_count, risk_level, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !data || data.length === 0) return DEMO_CLUSTERS;

  return data.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name || "Unnamed Cluster"),
    description: row.description ? String(row.description) : null,
    member_count: Number(row.member_count || 0),
    risk_level: String(row.risk_level || "HIGH"),
    created_at: String(row.created_at || new Date().toISOString()),
  }));
}

export async function getThreatBreakdown(
  orgId: string | null
): Promise<ThreatBreakdownItem[]> {
  if (!orgId) return DEMO_BREAKDOWN;

  const supabase = createServiceClient();
  if (!supabase) return DEMO_BREAKDOWN;

  const { data, error } = await supabase
    .from("scam_entities")
    .select("entity_type, risk_level");

  if (error || !data || data.length === 0) return DEMO_BREAKDOWN;

  const counts = new Map<string, number>();
  for (const row of data) {
    const key = `${row.entity_type}|${row.risk_level}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries()).map(([key, count]) => {
    const [entity_type, risk_level] = key.split("|");
    return { entity_type, risk_level, count };
  });
}
