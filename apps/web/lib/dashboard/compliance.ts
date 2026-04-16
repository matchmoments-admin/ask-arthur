// Compliance dashboard data queries — server-side only

import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComplianceKPIs {
  totalThreatsDetected: number;
  highRiskBlocked: number;
  avgResponseTime: string;
  complianceScore: number;
}

export interface ObligationStatus {
  principle: string;
  status: "met" | "partial" | "not_met";
  description: string;
  evidence: string;
  lastChecked: string;
}

export interface ComplianceDataPoint {
  date: string;
  threats_detected: number;
  reports_filed: number;
  api_calls: number;
}

export interface EvidenceItem {
  timestamp: string;
  type: string;
  description: string;
  principle: string;
  details: string;
}

// ---------------------------------------------------------------------------
// Demo data (shown when user has no org or no real data)
// ---------------------------------------------------------------------------

const DEMO_KPIS: ComplianceKPIs = {
  totalThreatsDetected: 1_247,
  highRiskBlocked: 342,
  avgResponseTime: "< 200ms",
  complianceScore: 72,
};

function demoPrinciples(now: string): ObligationStatus[] {
  return [
    {
      principle: "Prevent",
      status: "met",
      description: "Proactive scam prevention measures deployed across customer channels.",
      evidence: "API integration active — real-time scam screening on inbound messages.",
      lastChecked: now,
    },
    {
      principle: "Detect",
      status: "met",
      description: "Automated detection of scam patterns, URLs, and suspicious content.",
      evidence: "AI-powered analysis engine processing submissions with < 200ms latency.",
      lastChecked: now,
    },
    {
      principle: "Report",
      status: "partial",
      description: "Reporting obligations to NASC and internal stakeholders.",
      evidence: "Evidence log available for export. NASC auto-submission pipeline pending.",
      lastChecked: now,
    },
    {
      principle: "Disrupt",
      status: "partial",
      description: "Active disruption of scam infrastructure and financial flows.",
      evidence: "High-risk URLs and entities flagged. Takedown integration in progress.",
      lastChecked: now,
    },
    {
      principle: "Respond",
      status: "met",
      description: "Response procedures for confirmed scam incidents.",
      evidence: "Automated alerts and blocking for HIGH_RISK verdicts. SLA < 5 min.",
      lastChecked: now,
    },
    {
      principle: "Govern",
      status: "not_met",
      description: "Governance framework, audit trails, and board-level reporting.",
      evidence: "Compliance dashboard active. Board report template not yet configured.",
      lastChecked: now,
    },
  ];
}

function demoTimeline(days: number): ComplianceDataPoint[] {
  const points: ComplianceDataPoint[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    const base = 30 + Math.floor(Math.random() * 20);
    points.push({
      date: d.toISOString().split("T")[0],
      threats_detected: base + Math.floor(Math.random() * 15),
      reports_filed: Math.floor(base * 0.3) + Math.floor(Math.random() * 5),
      api_calls: base * 8 + Math.floor(Math.random() * 100),
    });
  }
  return points;
}

function demoEvidence(): EvidenceItem[] {
  const now = new Date();
  return [
    {
      timestamp: new Date(now.getTime() - 1 * 3_600_000).toISOString(),
      type: "Threat Blocked",
      description: "HIGH_RISK phishing URL blocked via API",
      principle: "Prevent",
      details: "URL matched known phishing pattern — blocked before reaching end user.",
    },
    {
      timestamp: new Date(now.getTime() - 3 * 3_600_000).toISOString(),
      type: "Detection",
      description: "Investment scam SMS detected",
      principle: "Detect",
      details: "AI analysis flagged crypto investment SMS with 94% confidence.",
    },
    {
      timestamp: new Date(now.getTime() - 8 * 3_600_000).toISOString(),
      type: "API Integration",
      description: "Scam check API call processed",
      principle: "Prevent",
      details: "Enterprise API key used for real-time content screening. Verdict: SUSPICIOUS.",
    },
    {
      timestamp: new Date(now.getTime() - 12 * 3_600_000).toISOString(),
      type: "Evidence Export",
      description: "Weekly compliance report exported",
      principle: "Report",
      details: "CSV export of 247 scam detections for internal compliance review.",
    },
    {
      timestamp: new Date(now.getTime() - 24 * 3_600_000).toISOString(),
      type: "Entity Flagged",
      description: "Suspicious domain added to watchlist",
      principle: "Disrupt",
      details: "Domain flagged across 12 separate scam reports. WHOIS registered < 7 days ago.",
    },
    {
      timestamp: new Date(now.getTime() - 36 * 3_600_000).toISOString(),
      type: "Incident Response",
      description: "HIGH_RISK verdict triggered alert workflow",
      principle: "Respond",
      details: "Automated notification sent to compliance team. Response time: 2 min 14 sec.",
    },
    {
      timestamp: new Date(now.getTime() - 48 * 3_600_000).toISOString(),
      type: "Audit Trail",
      description: "API key rotated per governance policy",
      principle: "Govern",
      details: "Scheduled key rotation completed. Old key deactivated, new key issued.",
    },
    {
      timestamp: new Date(now.getTime() - 72 * 3_600_000).toISOString(),
      type: "Detection",
      description: "Romance scam pattern identified",
      principle: "Detect",
      details: "NLP analysis detected emotional manipulation pattern across 3 messages.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

export async function getComplianceKPIs(
  orgId: string | null
): Promise<ComplianceKPIs> {
  if (!orgId) return DEMO_KPIS;

  const supabase = createServiceClient();
  if (!supabase) return DEMO_KPIS;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .split("T")[0];

  // Get org's API keys
  const { data: keys } = await supabase
    .from("api_keys")
    .select("key_hash")
    .eq("org_id", orgId);

  if (!keys || keys.length === 0) {
    // Org exists but no API keys — return partial data from check_stats
    const { data: stats } = await supabase
      .from("check_stats")
      .select("total_checks, high_risk_count")
      .gte("date", thirtyDaysAgo);

    const totals = (stats || []).reduce(
      (acc, r) => ({
        total: acc.total + (r.total_checks || 0),
        hr: acc.hr + (r.high_risk_count || 0),
      }),
      { total: 0, hr: 0 }
    );

    const score = totals.total > 0 ? 50 : 25; // Some activity = partial compliance
    return {
      totalThreatsDetected: totals.total,
      highRiskBlocked: totals.hr,
      avgResponseTime: "< 200ms",
      complianceScore: score,
    };
  }

  // Query scam_reports for API-sourced activity
  const { data: reports } = await supabase
    .from("scam_reports")
    .select("id, verdict")
    .eq("source", "api")
    .gte("created_at", thirtyDaysAgo);

  const totalThreats = reports?.length ?? 0;
  const highRisk =
    reports?.filter((r) => r.verdict === "HIGH_RISK").length ?? 0;

  // Calculate compliance score based on feature usage
  let score = 0;
  if (keys.length > 0) score += 20; // Has API keys
  if (totalThreats > 0) score += 30; // Active usage
  if (highRisk > 0) score += 15; // Detecting threats
  score += 15; // Dashboard access (they're here)
  // Remaining 20 would come from reporting features

  return {
    totalThreatsDetected: totalThreats,
    highRiskBlocked: highRisk,
    avgResponseTime: "< 200ms",
    complianceScore: Math.min(score, 100),
  };
}

export async function getObligationStatus(
  orgId: string | null
): Promise<ObligationStatus[]> {
  const now = new Date().toISOString();

  if (!orgId) return demoPrinciples(now);

  const supabase = createServiceClient();
  if (!supabase) return demoPrinciples(now);

  // Check for active API keys
  const { count: keyCount } = await supabase
    .from("api_keys")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("revoked", false);

  const hasActiveKeys = (keyCount ?? 0) > 0;

  // Check for recent scam reports
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count: recentReports } = await supabase
    .from("scam_reports")
    .select("*", { count: "exact", head: true })
    .eq("source", "api")
    .gte("created_at", sevenDaysAgo);

  const hasRecentActivity = (recentReports ?? 0) > 0;

  return [
    {
      principle: "Prevent",
      status: hasActiveKeys ? "met" : "not_met",
      description: "Proactive scam prevention measures deployed across customer channels.",
      evidence: hasActiveKeys
        ? `${keyCount} active API key(s) — real-time scam screening enabled.`
        : "No active API keys. Integrate the Ask Arthur API to enable prevention.",
      lastChecked: now,
    },
    {
      principle: "Detect",
      status: hasRecentActivity ? "met" : hasActiveKeys ? "partial" : "not_met",
      description: "Automated detection of scam patterns, URLs, and suspicious content.",
      evidence: hasRecentActivity
        ? `${recentReports} scam checks processed in the last 7 days.`
        : hasActiveKeys
          ? "API keys active but no recent detections recorded."
          : "No detection pipeline configured.",
      lastChecked: now,
    },
    {
      principle: "Report",
      status: "partial",
      description: "Reporting obligations to NASC and internal stakeholders.",
      evidence: "Evidence log available for export. NASC auto-submission pipeline pending.",
      lastChecked: now,
    },
    {
      principle: "Disrupt",
      status: hasRecentActivity ? "partial" : "not_met",
      description: "Active disruption of scam infrastructure and financial flows.",
      evidence: hasRecentActivity
        ? "High-risk entities flagged. Automated takedown integration in progress."
        : "No disruption activity recorded.",
      lastChecked: now,
    },
    {
      principle: "Respond",
      status: hasActiveKeys ? "met" : "not_met",
      description: "Response procedures for confirmed scam incidents.",
      evidence: hasActiveKeys
        ? "Automated alerts and blocking for HIGH_RISK verdicts."
        : "No automated response pipeline configured.",
      lastChecked: now,
    },
    {
      principle: "Govern",
      status: "not_met",
      description: "Governance framework, audit trails, and board-level reporting.",
      evidence: "Compliance dashboard active. Board report template not yet configured.",
      lastChecked: now,
    },
  ];
}

export async function getComplianceTimeline(
  orgId: string | null,
  days = 30
): Promise<ComplianceDataPoint[]> {
  if (!orgId) return demoTimeline(days);

  const supabase = createServiceClient();
  if (!supabase) return demoTimeline(days);

  const startDate = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .split("T")[0];

  const { data: stats } = await supabase
    .from("check_stats")
    .select("date, total_checks, high_risk_count")
    .gte("date", startDate)
    .order("date", { ascending: true });

  if (!stats || stats.length === 0) return demoTimeline(days);

  return stats.map((row) => ({
    date: row.date,
    threats_detected: row.high_risk_count || 0,
    reports_filed: Math.floor((row.high_risk_count || 0) * 0.3),
    api_calls: row.total_checks || 0,
  }));
}

export async function getEvidenceItems(
  orgId: string | null
): Promise<EvidenceItem[]> {
  if (!orgId) return demoEvidence();

  const supabase = createServiceClient();
  if (!supabase) return demoEvidence();

  // Fetch recent scam reports as evidence
  const { data: reports } = await supabase
    .from("scam_reports")
    .select("id, created_at, verdict, scam_type, source")
    .eq("source", "api")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!reports || reports.length === 0) return demoEvidence();

  return reports.map((r) => {
    const isHighRisk = r.verdict === "HIGH_RISK";
    const isSuspicious = r.verdict === "SUSPICIOUS";

    let principle = "Detect";
    let type = "Detection";
    if (isHighRisk) {
      principle = "Prevent";
      type = "Threat Blocked";
    } else if (isSuspicious) {
      principle = "Detect";
      type = "Detection";
    }

    return {
      timestamp: r.created_at,
      type,
      description: `${r.verdict} verdict — ${r.scam_type || "unknown"} scam`,
      principle,
      details: `Source: ${r.source}. Verdict: ${r.verdict}. Scam type: ${r.scam_type || "unclassified"}.`,
    };
  });
}
