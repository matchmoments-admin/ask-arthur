// Dashboard data queries — server-side only (uses service client)

import { createServiceClient } from "@askarthur/supabase/server";

export interface DashboardKPIs {
  totalChecks: number;
  highRiskCount: number;
  suspiciousCount: number;
  safeCount: number;
  prevTotalChecks: number;
  prevHighRiskCount: number;
  estimatedLossesPrevented: number;
  feedItemCount: number;
  entityCount: number;
  scanCount: number;
}

export interface ScamTypeRow {
  category: string;
  count: number;
  pct: number;
}

export interface ChannelRow {
  channel: string;
  count: number;
  pct: number;
}

export interface ThreatEntity {
  id: number;
  entity_type: string;
  normalized_value: string;
  report_count: number;
  risk_level: string | null;
  risk_score: number | null;
  last_seen: string;
  first_seen: string;
}

export interface RecentScan {
  id: number;
  scan_type: string;
  target: string;
  target_display: string | null;
  grade: string;
  overall_score: number;
  share_token: string;
  scanned_at: string;
}

const AVG_LOSS_PER_SCAM = 540; // ABS average scam loss AU

export async function getDashboardKPIs(days = 7): Promise<DashboardKPIs> {
  const supabase = createServiceClient();
  const empty: DashboardKPIs = {
    totalChecks: 0, highRiskCount: 0, suspiciousCount: 0, safeCount: 0,
    prevTotalChecks: 0, prevHighRiskCount: 0, estimatedLossesPrevented: 0,
    feedItemCount: 0, entityCount: 0, scanCount: 0,
  };
  if (!supabase) return empty;

  const now = new Date();
  const daysAgo = new Date(now.getTime() - days * 86400000).toISOString().split("T")[0];
  const prevStart = new Date(now.getTime() - days * 2 * 86400000).toISOString().split("T")[0];

  // Current period
  const { data: current } = await supabase
    .from("check_stats")
    .select("total_checks, safe_count, suspicious_count, high_risk_count")
    .gte("date", daysAgo);

  const totals = (current || []).reduce(
    (acc, r) => ({
      totalChecks: acc.totalChecks + (r.total_checks || 0),
      highRiskCount: acc.highRiskCount + (r.high_risk_count || 0),
      suspiciousCount: acc.suspiciousCount + (r.suspicious_count || 0),
      safeCount: acc.safeCount + (r.safe_count || 0),
    }),
    { totalChecks: 0, highRiskCount: 0, suspiciousCount: 0, safeCount: 0 }
  );

  // Previous period (for delta)
  const { data: prev } = await supabase
    .from("check_stats")
    .select("total_checks, high_risk_count")
    .gte("date", prevStart)
    .lt("date", daysAgo);

  const prevTotals = (prev || []).reduce(
    (acc, r) => ({
      prevTotalChecks: acc.prevTotalChecks + (r.total_checks || 0),
      prevHighRiskCount: acc.prevHighRiskCount + (r.high_risk_count || 0),
    }),
    { prevTotalChecks: 0, prevHighRiskCount: 0 }
  );

  // Counts
  const { count: feedCount } = await supabase
    .from("feed_items")
    .select("*", { count: "exact", head: true })
    .eq("published", true);

  const { count: entityCount } = await supabase
    .from("scam_entities")
    .select("*", { count: "exact", head: true });

  const { count: scanCount } = await supabase
    .from("scan_results")
    .select("*", { count: "exact", head: true });

  // Add site_audits to scan count
  const { count: siteCount } = await supabase
    .from("site_audits")
    .select("*", { count: "exact", head: true });

  return {
    ...totals,
    ...prevTotals,
    estimatedLossesPrevented: totals.highRiskCount * AVG_LOSS_PER_SCAM,
    feedItemCount: feedCount ?? 0,
    entityCount: entityCount ?? 0,
    scanCount: (scanCount ?? 0) + (siteCount ?? 0),
  };
}

export async function getScamTypeBreakdown(_days = 30): Promise<ScamTypeRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("feed_items")
    .select("category")
    .eq("published", true)
    .not("category", "is", null);

  if (!data) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    const cat = row.category || "other";
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  const total = data.length || 1;
  return Array.from(counts.entries())
    .map(([category, count]) => ({
      category,
      count,
      pct: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export async function getChannelSplit(): Promise<ChannelRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("feed_items")
    .select("source")
    .eq("published", true);

  if (!data) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    counts.set(row.source, (counts.get(row.source) || 0) + 1);
  }

  const total = data.length || 1;
  return Array.from(counts.entries())
    .map(([channel, count]) => ({
      channel,
      count,
      pct: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

export async function getRecentThreats(limit = 10): Promise<ThreatEntity[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("scam_entities")
    .select("id, entity_type, normalized_value, report_count, risk_level, risk_score, last_seen, first_seen")
    .order("last_seen", { ascending: false })
    .limit(limit);

  return data || [];
}

export async function getRecentScans(limit = 10): Promise<RecentScan[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const results: RecentScan[] = [];

  const { data: scanData } = await supabase
    .from("scan_results")
    .select("id, scan_type, target, target_display, grade, overall_score, share_token, scanned_at")
    .eq("visibility", "public")
    .order("scanned_at", { ascending: false })
    .limit(limit);

  if (scanData) results.push(...scanData);

  const { data: siteData } = await supabase
    .from("site_audits")
    .select("id, overall_score, grade, scanned_at, share_token, sites!inner(domain)")
    .order("scanned_at", { ascending: false })
    .limit(limit);

  if (siteData) {
    for (const s of siteData) {
      const site = s.sites as unknown as { domain: string };
      results.push({
        id: s.id,
        scan_type: "website",
        target: site.domain,
        target_display: site.domain,
        grade: s.grade,
        overall_score: s.overall_score,
        share_token: s.share_token,
        scanned_at: s.scanned_at,
      });
    }
  }

  results.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
  return results.slice(0, limit);
}

const CATEGORY_LABELS: Record<string, string> = {
  phishing: "Phishing",
  romance_scam: "Romance / Pig Butchering",
  investment_fraud: "Investment / Crypto",
  tech_support: "Tech Support",
  impersonation: "Impersonation",
  shopping_scam: "Shopping Scam",
  phone_scam: "Phone Scam",
  email_scam: "Email Scam",
  sms_scam: "SMS Scam",
  employment_scam: "Employment Scam",
  advance_fee: "Advance Fee",
  rental_scam: "Rental Scam",
  sextortion: "Sextortion",
  other: "Other",
};

export function getCategoryLabel(key: string): string {
  return CATEGORY_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const SOURCE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  user_report: "User Reports",
  verified_scam: "Verified Intel",
  scamwatch: "Scamwatch",
};

export function getSourceLabel(key: string): string {
  return SOURCE_LABELS[key] || key;
}
