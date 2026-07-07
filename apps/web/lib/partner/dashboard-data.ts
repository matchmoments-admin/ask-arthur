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
import { regionToStateCode, type AuJurisdiction } from "./framing";

export interface JurisdictionThreatPicture {
  /** Report volume per AU state, for the choropleth. */
  stateData: Record<string, number>;
  /** Aggregates for the selected jurisdiction (null when none selected). */
  focus: {
    jurisdiction: AuJurisdiction;
    totalReports: number;
    highRiskReports: number;
    totalLoss: number;
    topScamTypes: string[];
    topBrands: string[];
  } | null;
  /** True when the data source was unavailable (renders an empty state). */
  unavailable: boolean;
}

interface JurisdictionRegionRow {
  effective_region: string | null;
  total_reports: number;
  high_risk_reports: number;
  total_loss: number;
  scam_types: string[] | null;
  brands: string[] | null;
}

export async function getJurisdictionThreatPicture(
  jurisdiction: AuJurisdiction | null,
): Promise<JurisdictionThreatPicture> {
  const supabase = createServiceClient();
  if (!supabase) return { stateData: {}, focus: null, unavailable: true };

  // No country filter: target_country is unpopulated on scam_reports; the RPC
  // groups by COALESCE(target_region, region), and region strings already
  // carry AU states. Non-AU regions fall out during state bucketing below.
  const { data, error } = await supabase.rpc("get_jurisdiction_summary", {
    p_min_reports: 1,
  });
  if (error || !data) return { stateData: {}, focus: null, unavailable: true };

  const regions = ((data as { regions?: JurisdictionRegionRow[] }).regions ?? []) as JurisdictionRegionRow[];

  const stateData: Record<string, number> = {};
  let focusReports = 0;
  let focusHighRisk = 0;
  let focusLoss = 0;
  const focusScamTypes = new Set<string>();
  const focusBrands = new Set<string>();

  for (const row of regions) {
    const stateCode = regionToStateCode(row.effective_region);
    if (!stateCode) continue;
    stateData[stateCode] = (stateData[stateCode] ?? 0) + (row.total_reports ?? 0);

    if (jurisdiction && stateCode === jurisdiction) {
      focusReports += row.total_reports ?? 0;
      focusHighRisk += row.high_risk_reports ?? 0;
      focusLoss += Number(row.total_loss ?? 0);
      (row.scam_types ?? []).forEach((s) => s && focusScamTypes.add(s));
      (row.brands ?? []).forEach((b) => b && focusBrands.add(b));
    }
  }

  return {
    stateData,
    focus: jurisdiction
      ? {
          jurisdiction,
          totalReports: focusReports,
          highRiskReports: focusHighRisk,
          totalLoss: focusLoss,
          topScamTypes: [...focusScamTypes].slice(0, 8),
          topBrands: [...focusBrands].slice(0, 8),
        }
      : null,
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
