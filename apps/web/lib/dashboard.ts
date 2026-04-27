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

export interface KpiTimeSeries {
  checks: number[];
  highRisk: number[];
  losses: number[];
  intel: number[];
}

export async function getKpiTimeSeries(days = 30): Promise<KpiTimeSeries> {
  const supabase = createServiceClient();
  const empty: KpiTimeSeries = { checks: [], highRisk: [], losses: [], intel: [] };
  if (!supabase) return empty;

  const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

  const { data: stats } = await supabase
    .from("check_stats")
    .select("date, total_checks, high_risk_count")
    .gte("date", since)
    .order("date", { ascending: true });

  const byDate = new Map<string, { total: number; high: number }>();
  for (const r of stats || []) {
    const cur = byDate.get(r.date) || { total: 0, high: 0 };
    byDate.set(r.date, {
      total: cur.total + (r.total_checks || 0),
      high: cur.high + (r.high_risk_count || 0),
    });
  }
  const sorted = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  const checks = sorted.map(([, v]) => v.total);
  const highRisk = sorted.map(([, v]) => v.high);
  const losses = highRisk.map((h) => h * AVG_LOSS_PER_SCAM);

  const { data: intelRows } = await supabase
    .from("scam_entities")
    .select("first_seen")
    .gte("first_seen", since);
  const intelByDate = new Map<string, number>();
  for (const r of intelRows || []) {
    const d = (r.first_seen as string).slice(0, 10);
    intelByDate.set(d, (intelByDate.get(d) || 0) + 1);
  }
  const intel = sorted.map(([d]) => intelByDate.get(d) || 0);

  return { checks, highRisk, losses, intel };
}

export interface TriageItem {
  id: string;
  severity: "critical" | "high" | "medium";
  kind: string;
  title: string;
  detail: string;
  ageMinutes: number;
}

export async function getTriageItems(limit = 6): Promise<TriageItem[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const { data } = await supabase
    .from("scam_entities")
    .select(
      "id, entity_type, normalized_value, risk_level, risk_score, report_count, last_seen, first_seen",
    )
    .gte("last_seen", since)
    .in("risk_level", ["CRITICAL", "HIGH", "MEDIUM"])
    .order("risk_score", { ascending: false, nullsFirst: false })
    .order("report_count", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((e) => {
    const sev =
      e.risk_level === "CRITICAL"
        ? "critical"
        : e.risk_level === "HIGH"
          ? "high"
          : "medium";
    const ageMs = Date.now() - new Date(e.last_seen as string).getTime();
    const ageMinutes = Math.max(1, Math.round(ageMs / 60000));
    const newWindow = Date.now() - new Date(e.first_seen as string).getTime() < 6 * 3600 * 1000;
    const kind = newWindow ? "New entity" : "Active";
    return {
      id: String(e.id),
      severity: sev as "critical" | "high" | "medium",
      kind,
      title: e.normalized_value as string,
      detail: `${(e.entity_type as string).toUpperCase()} · score ${e.risk_score ?? "—"} · ${e.report_count ?? 0} reports`,
      ageMinutes,
    };
  });
}

export interface ActivityItem {
  id: string;
  kind: "scan" | "detect" | "report";
  text: string;
  meta: string;
  ageSeconds: number;
}

export async function getRecentActivity(limit = 7): Promise<ActivityItem[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const [{ data: scans }, { data: entities }] = await Promise.all([
    supabase
      .from("scan_results")
      .select("id, scan_type, target_display, target, grade, scanned_at")
      .order("scanned_at", { ascending: false })
      .limit(limit),
    supabase
      .from("scam_entities")
      .select("id, entity_type, normalized_value, risk_level, risk_score, first_seen")
      .order("first_seen", { ascending: false })
      .limit(limit),
  ]);

  const items: ActivityItem[] = [];
  for (const s of scans || []) {
    items.push({
      id: `scan-${s.id}`,
      kind: "scan",
      text: `Scan ${s.grade ?? "completed"}`,
      meta: `${s.target_display ?? s.target} · ${s.scan_type}`,
      ageSeconds: Math.max(1, Math.round((Date.now() - new Date(s.scanned_at as string).getTime()) / 1000)),
    });
  }
  for (const e of entities || []) {
    items.push({
      id: `entity-${e.id}`,
      kind: "detect",
      text: `New ${e.risk_level ?? ""} entity detected`.trim(),
      meta: `${e.normalized_value} · ${e.entity_type} · score ${e.risk_score ?? "—"}`,
      ageSeconds: Math.max(1, Math.round((Date.now() - new Date(e.first_seen as string).getTime()) / 1000)),
    });
  }
  items.sort((a, b) => a.ageSeconds - b.ageSeconds);
  return items.slice(0, limit);
}

export interface SpfPrinciple {
  key: "prevent" | "detect" | "report" | "disrupt" | "respond" | "govern";
  label: string;
  status: "met" | "partial" | "missed";
  pct: number;
  desc: string;
}

export function getSpfPosture(): { principles: SpfPrinciple[]; overallPct: number } {
  // Aggregated view of the SPF Act 2025 six principles. Status here is curated,
  // grounded in the existing ComplianceChecklist (apps/web/components/dashboard/
  // ComplianceChecklist.tsx) and the live data layer; surfaces the framework
  // shape on the home dashboard. Long-term, replace with a dedicated
  // spf_principle_events table per BACKLOG.md "Database Hygiene & SPF Readiness".
  const principles: SpfPrinciple[] = [
    {
      key: "prevent",
      label: "Prevent",
      status: "met",
      pct: 1.0,
      desc: "Proactive detection across user channels (web, ext, bots, mobile)",
    },
    {
      key: "detect",
      label: "Detect",
      status: "met",
      pct: 0.92,
      desc: "Claude verdict pipeline + 16 threat-feed scrapers",
    },
    {
      key: "report",
      label: "Report",
      status: "partial",
      pct: 0.45,
      desc: "Monthly + NASC submission pipelines pending",
    },
    {
      key: "disrupt",
      label: "Disrupt",
      status: "partial",
      pct: 0.6,
      desc: "AFCX intel sharing in design; takedown bridges queued",
    },
    {
      key: "respond",
      label: "Respond",
      status: "met",
      pct: 0.88,
      desc: "Ops respond to triage queue and live alerts",
    },
    {
      key: "govern",
      label: "Govern",
      status: "partial",
      pct: 0.7,
      desc: "APRA CPS 230 audit log in progress",
    },
  ];
  const overallPct =
    principles.reduce((s, p) => s + p.pct, 0) / principles.length;
  return { principles, overallPct };
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
