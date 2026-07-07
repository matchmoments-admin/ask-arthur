/**
 * Partner-dashboard data loaders. De-identified AGGREGATES ONLY — no PII, no
 * scanned content, no per-report rows leave here. Reads via the service client
 * because the underlying `get_jurisdiction_summary` RPC is SECURITY DEFINER
 * with EXECUTE revoked from anon/authenticated (v110); the admin route is the
 * only caller. Reuses the dormant "for state police" aggregate rather than
 * adding new SQL (no migration).
 */
import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";
import { regionToStateCode, tallyRanked, type AuJurisdiction, type RankedItem } from "./framing";

export interface JurisdictionThreatPicture {
  /** Report volume per AU state, for the choropleth (all-time). */
  stateData: Record<string, number>;
  /** All-time reported loss for the selected jurisdiction (null when none). */
  focusLoss: number | null;
  /** True when the data source was unavailable (renders an empty state). */
  unavailable: boolean;
}

interface JurisdictionRegionRow {
  effective_region: string | null;
  total_reports: number;
  total_loss: number;
}

/**
 * All-time state report volumes (for the choropleth) + the selected
 * jurisdiction's total reported loss. Ranked scam types / brands and the trend
 * come from `getJurisdictionTrend` (the daily-summary view) — this loader owns
 * only what `get_jurisdiction_summary` uniquely provides (loss).
 */
export async function getJurisdictionThreatPicture(
  jurisdiction: AuJurisdiction | null,
): Promise<JurisdictionThreatPicture> {
  const supabase = createServiceClient();
  if (!supabase) return { stateData: {}, focusLoss: null, unavailable: true };

  // No country filter: target_country is unpopulated on scam_reports; the RPC
  // groups by COALESCE(target_region, region), and region strings already
  // carry AU states. Non-AU regions fall out during state bucketing below.
  const { data, error } = await supabase.rpc("get_jurisdiction_summary", {
    p_min_reports: 1,
  });
  if (error || !data) return { stateData: {}, focusLoss: null, unavailable: true };

  const regions = ((data as { regions?: JurisdictionRegionRow[] }).regions ?? []) as JurisdictionRegionRow[];

  const stateData: Record<string, number> = {};
  let focusLoss = 0;
  for (const row of regions) {
    const stateCode = regionToStateCode(row.effective_region);
    if (!stateCode) continue;
    stateData[stateCode] = (stateData[stateCode] ?? 0) + (row.total_reports ?? 0);
    if (jurisdiction && stateCode === jurisdiction) {
      focusLoss += Number(row.total_loss ?? 0);
    }
  }

  return {
    stateData,
    focusLoss: jurisdiction ? focusLoss : null,
    unavailable: false,
  };
}

export interface TrendPoint {
  date: string;
  checks: number;
  highRisk: number;
  reports: number;
}

export interface JurisdictionTrend {
  /** Daily series for the jurisdiction, oldest → newest. */
  series: TrendPoint[];
  /** Windowed totals. */
  totalReports: number;
  totalHighRisk: number;
  /** Ranked by frequency across the window (the brief's "top scam types/brands"). */
  topScamTypes: RankedItem[];
  topBrands: RankedItem[];
  windowDays: number;
  unavailable: boolean;
}

interface DailySummaryRow {
  date: string;
  region: string | null;
  total_checks: number;
  high_risk_count: number;
  scam_reports_count: number;
  top_scam_types: string[] | null;
  top_brands: string[] | null;
}

// Placeholder classifier values that aren't real scam types / brands — dropped
// so the ranked lists read cleanly in a partner demo (e.g. "none" for a SAFE
// check should never appear as a "top scam type").
const NOISE_TOKENS = new Set(["none", "unknown", "n/a", "na", "other", "null"]);
function dropNoise(arr: string[] | null): string[] {
  return (arr ?? []).filter((x) => x && !NOISE_TOKENS.has(x.trim().toLowerCase()));
}

/**
 * Regional TRENDS + ranked top scam types / brands from
 * `threat_intel_daily_summary` (the view the pilot brief names — it carries a
 * date dimension and ranked arrays). De-identified aggregates only. The view's
 * `region` uses the same mixed code/full-name forms, so it goes through the
 * tested `regionToStateCode`.
 */
export async function getJurisdictionTrend(
  jurisdiction: AuJurisdiction,
  windowDays = 30,
): Promise<JurisdictionTrend> {
  const empty: JurisdictionTrend = {
    series: [],
    totalReports: 0,
    totalHighRisk: 0,
    topScamTypes: [],
    topBrands: [],
    windowDays,
    unavailable: true,
  };
  const supabase = createServiceClient();
  if (!supabase) return empty;

  const cutoffDate = new Date(Date.now() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabase
    .from("threat_intel_daily_summary")
    .select("date, region, total_checks, high_risk_count, scam_reports_count, top_scam_types, top_brands")
    .gte("date", cutoffDate)
    .order("date", { ascending: true });
  if (error || !data) return empty;

  const byDate = new Map<string, TrendPoint>();
  const scamTypeRows: (string[] | null)[] = [];
  const brandRows: (string[] | null)[] = [];
  let totalReports = 0;
  let totalHighRisk = 0;

  for (const row of data as DailySummaryRow[]) {
    if (regionToStateCode(row.region) !== jurisdiction) continue;
    const pt = byDate.get(row.date) ?? { date: row.date, checks: 0, highRisk: 0, reports: 0 };
    pt.checks += row.total_checks ?? 0;
    pt.highRisk += row.high_risk_count ?? 0;
    pt.reports += row.scam_reports_count ?? 0;
    byDate.set(row.date, pt);
    totalReports += row.scam_reports_count ?? 0;
    totalHighRisk += row.high_risk_count ?? 0;
    scamTypeRows.push(dropNoise(row.top_scam_types));
    brandRows.push(dropNoise(row.top_brands));
  }

  return {
    series: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    totalReports,
    totalHighRisk,
    topScamTypes: tallyRanked(scamTypeRows),
    topBrands: tallyRanked(brandRows),
    windowDays,
    unavailable: false,
  };
}

export interface RouteClickFunnel {
  /** Destination label → tap count, most-tapped first. */
  rows: { routeLabel: string; count: number }[];
  total: number;
}

/**
 * Aggregate the metadata-only `reporting_route_click` events into a
 * destination funnel. Optionally scoped to a jurisdiction. Aggregated in TS
 * over a bounded recent window — fine at pilot volume; a dedicated aggregate
 * RPC is the follow-up if this grows. Returns empty until
 * FF_ROUTE_CLICK_TELEMETRY has been on long enough to collect taps.
 */
export async function getRouteClickFunnel(
  jurisdiction: AuJurisdiction | null,
): Promise<RouteClickFunnel> {
  const supabase = createServiceClient();
  if (!supabase) return { rows: [], total: 0 };

  const { data, error } = await supabase
    .from("analytics_events")
    .select("event_props")
    .eq("event_type", "reporting_route_click")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error || !data) return { rows: [], total: 0 };

  const counts = new Map<string, number>();
  let total = 0;
  for (const row of data as { event_props: Record<string, unknown> | null }[]) {
    const props = row.event_props ?? {};
    if (jurisdiction && String(props.jurisdiction ?? "") !== jurisdiction) continue;
    const label = String(props.routeLabel ?? "").trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    total += 1;
  }

  const rows = [...counts.entries()]
    .map(([routeLabel, count]) => ({ routeLabel, count }))
    .sort((a, b) => b.count - a.count);

  return { rows, total };
}
