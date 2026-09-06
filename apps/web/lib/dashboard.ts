// Dashboard data queries — server-side only (uses service client)

import { createServiceClient } from "@askarthur/supabase/server";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import {
  canonicalScamTypeLabel,
  toCanonicalScamType,
  type CanonicalScamType,
} from "@askarthur/types/scam-taxonomy";

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

/**
 * Top scam categories over a real window.
 *
 * THREE THINGS WERE WRONG, and they compounded.
 *
 * 1. The window was accepted and ignored. The signature was
 *    `getScamTypeBreakdown(_days = 30)` — underscored to silence the linter —
 *    and the query had no date filter at all. `app/app/page.tsx` passes 30 and
 *    SafeScamTypes captions the result "Last 30 days · by volume" plus a "30d"
 *    chip. All-time data under a one-month claim, twice over.
 *
 *    This is a class the repo has fixed twice already: see the post-mortem in
 *    admin/brand-alerts/BrandAlertsDashboard.tsx ("32 detections vs 2 actually
 *    in-window", #941 finding 1) and the note at dashboard/admin-health.ts
 *    naming the #941 finding-10 class. Two live surfaces still had it.
 *
 * 2. It read `feed_items.category`, which is NULL on 3,131 of 6,447 published
 *    rows — 48.6%. So the chart was all-time data from half the corpus.
 *    `reddit_post_intel.intent_label` carries a category for all 5,979 rows.
 *
 * 3. Counting the two vocabularies apart. `intent_label` and the analyze
 *    path's `scam_type` disagree on romance/romance_scam,
 *    investment/investment_fraud and smishing/sms_scam, so any tally that
 *    does not canonicalise under-reports each by the other's share.
 *    `toCanonicalScamType` is the one home for that mapping.
 *
 * BUCKETED ON THE POST'S OWN DATE, not on when we classified it. Using
 * `processed_at` would make any backfill read as a scam wave — measured at the
 * time: 1,134 rows in a trailing 28 days by processing date against 847 by
 * post date. Same reasoning, and the same fix, as lib/scam-type-trend.ts.
 *
 * `other` is excluded from the ranking, following NOISE_TOKENS in
 * lib/partner/dashboard-data.ts. It means "a scam we could not categorise" and
 * would otherwise lead every chart (159 of the last 30 days) while telling a
 * reader nothing. The caption says *categorised* so the words stay true.
 */
export async function getScamTypeBreakdown(days = 30): Promise<ScamTypeRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Paginated: 30 days is ~1,200 rows today and PostgREST caps a single read
  // at 1,000. A truncated read here would not error — it would quietly
  // under-count the categories that happen to sort last.
  const { rows, error } = await fetchAllRows<{
    intent_label: string | null;
    feed_items:
      | { source_created_at: string }
      | { source_created_at: string }[]
      | null;
  }>(
    (from, to) =>
      supabase
        .from("reddit_post_intel")
        // !inner so the filter on the embedded date restricts parent rows
        // rather than merely nulling the embed.
        .select("intent_label, feed_items!inner(source_created_at)")
        .gte("feed_items.source_created_at", since)
        .order("id", { ascending: true })
        .range(from, to),
    { maxRows: 100_000 },
  );
  if (error) return [];

  const counts = new Map<CanonicalScamType, number>();
  for (const row of rows) {
    const type = toCanonicalScamType(row.intent_label);
    // null means "not a scam type" — `informational` and `none` are explicit
    // judgements that a post is not a scam, and counting them would inflate
    // every total with posts we decided were not scams.
    if (!type || type === "other") continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  // Percentages are of the categorised total, matching the caption. Taking
  // them over the raw row count would make the bars sum to well under 100%
  // with no visible reason.
  const total = [...counts.values()].reduce((n, c) => n + c, 0) || 1;
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

/**
 * Display names now come from the taxonomy, not a second copy here.
 *
 * The old CATEGORY_LABELS held keys from BOTH vocabularies and title-cased
 * anything it missed — so `romance` rendered as "Romance" while `romance_scam`
 * rendered as "Romance / Pig Butchering", two rows for one thing, and neither
 * `investment` nor `smishing` had an entry at all.
 */
export function getCategoryLabel(key: string): string {
  const canonical = toCanonicalScamType(key);
  if (canonical) return canonicalScamTypeLabel(canonical);
  // An unmapped value should be visible, not silently retitled — the taxonomy
  // drift test is what stops one appearing.
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

export async function getCheckTimeSeries(days = 30) {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const since = new Date(Date.now() - days * 86400000)
    .toISOString()
    .split("T")[0];
  const { data } = await supabase
    .from("check_stats")
    .select("date, total_checks, high_risk_count")
    .gte("date", since)
    .order("date", { ascending: true });

  if (!data) return [];

  const byDate = new Map<string, { total: number; high_risk: number }>();
  for (const row of data) {
    const existing = byDate.get(row.date) || { total: 0, high_risk: 0 };
    byDate.set(row.date, {
      total: existing.total + (row.total_checks || 0),
      high_risk: existing.high_risk + (row.high_risk_count || 0),
    });
  }

  return Array.from(byDate.entries()).map(([date, vals]) => ({
    date,
    total: vals.total,
    high_risk: vals.high_risk,
  }));
}
