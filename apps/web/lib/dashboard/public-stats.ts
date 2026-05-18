// Public stats loaders for the /about and /scam-map pages.
//
// `getWorldStats` was previously duplicated across both pages; consolidated
// here. `getChartData` is only consumed by /about.

import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";
import { parseStateFromRegion } from "@/lib/chart-tokens";

interface StatsRow {
  safe_count: number;
  suspicious_count: number;
  high_risk_count: number;
  region: string | null;
}

export interface ChartData {
  safeCount: number;
  suspiciousCount: number;
  highRiskCount: number;
  stateData: Record<string, number>;
}

export async function getChartData(): Promise<ChartData> {
  const supabase = createServiceClient();
  if (!supabase) {
    return { safeCount: 0, suspiciousCount: 0, highRiskCount: 0, stateData: {} };
  }

  const { data, error } = await supabase
    .from("check_stats")
    .select("safe_count, suspicious_count, high_risk_count, region");

  if (error || !data) {
    return { safeCount: 0, suspiciousCount: 0, highRiskCount: 0, stateData: {} };
  }

  let safeCount = 0;
  let suspiciousCount = 0;
  let highRiskCount = 0;
  const stateData: Record<string, number> = {};

  for (const row of data as StatsRow[]) {
    safeCount += row.safe_count ?? 0;
    suspiciousCount += row.suspicious_count ?? 0;
    highRiskCount += row.high_risk_count ?? 0;

    if (row.region) {
      const stateCode = parseStateFromRegion(row.region);
      if (stateCode) {
        const rowTotal =
          (row.safe_count ?? 0) +
          (row.suspicious_count ?? 0) +
          (row.high_risk_count ?? 0);
        stateData[stateCode] = (stateData[stateCode] ?? 0) + rowTotal;
      }
    }
  }

  return { safeCount, suspiciousCount, highRiskCount, stateData };
}

export async function getWorldStats(): Promise<Record<string, number>> {
  const supabase = createServiceClient();
  if (!supabase) return {};

  const { data, error } = await supabase.rpc("get_world_scam_stats", {
    days_back: 30,
  });

  if (error || !data) return {};

  const map: Record<string, number> = {};
  for (const row of data as Array<{ country_code: string; scam_count: number }>) {
    map[row.country_code] = row.scam_count;
  }
  return map;
}
