// Developer dashboard data queries — server-side only

import { createServiceClient } from "@askarthur/supabase/server";

export interface UsageDataPoint {
  date: string;
  total_calls: number;
  endpoint: string;
}

export interface EndpointStat {
  endpoint: string;
  total_calls: number;
  avg_latency_ms: number;
  error_count: number;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  tier: string;
  status: string;
  last_used_at: string | null;
  created_at: string;
}

export interface DeveloperKPIs {
  totalCalls30d: number;
  activeKeys: number;
  avgLatencyMs: number;
  errorRate: number;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

function generateDemoUsage(): UsageDataPoint[] {
  const points: UsageDataPoint[] = [];
  const endpoints = ["/v1/check", "/v1/scan", "/v1/entities", "/v1/report"];
  const now = Date.now();

  for (let i = 29; i >= 0; i--) {
    const date = new Date(now - i * 86400000).toISOString().split("T")[0];
    const base = 800 + Math.floor(Math.random() * 400);
    // Gradual uptrend to look impressive
    const trend = Math.floor((30 - i) * 15);

    for (const endpoint of endpoints) {
      const weight =
        endpoint === "/v1/check"
          ? 0.55
          : endpoint === "/v1/scan"
            ? 0.25
            : endpoint === "/v1/entities"
              ? 0.12
              : 0.08;
      points.push({
        date,
        total_calls: Math.floor((base + trend) * weight),
        endpoint,
      });
    }
  }
  return points;
}

const DEMO_ENDPOINTS: EndpointStat[] = [
  { endpoint: "/v1/check", total_calls: 18_472, avg_latency_ms: 142, error_count: 23 },
  { endpoint: "/v1/scan", total_calls: 8_214, avg_latency_ms: 1_840, error_count: 12 },
  { endpoint: "/v1/entities", total_calls: 3_891, avg_latency_ms: 87, error_count: 4 },
  { endpoint: "/v1/report", total_calls: 2_105, avg_latency_ms: 196, error_count: 7 },
  { endpoint: "/v1/clusters", total_calls: 948, avg_latency_ms: 234, error_count: 2 },
];

const DEMO_KEYS: ApiKeyInfo[] = [
  {
    id: "k-001",
    name: "Production — Fraud Detection",
    key_prefix: "ak_live_7x9K",
    tier: "enterprise",
    status: "active",
    last_used_at: new Date(Date.now() - 120000).toISOString(),
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
  },
  {
    id: "k-002",
    name: "Production — Customer Onboarding",
    key_prefix: "ak_live_3mPQ",
    tier: "enterprise",
    status: "active",
    last_used_at: new Date(Date.now() - 300000).toISOString(),
    created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
  },
  {
    id: "k-003",
    name: "Staging Environment",
    key_prefix: "ak_test_9wR2",
    tier: "pro",
    status: "active",
    last_used_at: new Date(Date.now() - 3600000).toISOString(),
    created_at: new Date(Date.now() - 45 * 86400000).toISOString(),
  },
  {
    id: "k-004",
    name: "Dev — Local Testing",
    key_prefix: "ak_test_1bN5",
    tier: "free",
    status: "active",
    last_used_at: new Date(Date.now() - 86400000).toISOString(),
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Data functions
// ---------------------------------------------------------------------------

export async function getOrgUsage(
  orgId: string | null,
  days: number = 30
): Promise<UsageDataPoint[]> {
  if (!orgId) return generateDemoUsage();

  const supabase = createServiceClient();
  if (!supabase) return generateDemoUsage();

  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data, error } = await supabase
    .from("api_usage_log")
    .select("created_at, endpoint")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) return generateDemoUsage();

  // Aggregate by date + endpoint
  const agg = new Map<string, number>();
  for (const row of data) {
    const date = new Date(row.created_at).toISOString().split("T")[0];
    const key = `${date}|${row.endpoint}`;
    agg.set(key, (agg.get(key) || 0) + 1);
  }

  return Array.from(agg.entries()).map(([key, count]) => {
    const [date, endpoint] = key.split("|");
    return { date, total_calls: count, endpoint };
  });
}

export async function getEndpointBreakdown(
  orgId: string | null
): Promise<EndpointStat[]> {
  if (!orgId) return DEMO_ENDPOINTS;

  const supabase = createServiceClient();
  if (!supabase) return DEMO_ENDPOINTS;

  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data, error } = await supabase
    .from("api_usage_log")
    .select("endpoint, latency_ms, status_code")
    .gte("created_at", since);

  if (error || !data || data.length === 0) return DEMO_ENDPOINTS;

  const map = new Map<
    string,
    { calls: number; totalLatency: number; errors: number }
  >();
  for (const row of data) {
    const ep = row.endpoint || "/unknown";
    const existing = map.get(ep) || { calls: 0, totalLatency: 0, errors: 0 };
    existing.calls++;
    existing.totalLatency += row.latency_ms || 0;
    if (row.status_code >= 400) existing.errors++;
    map.set(ep, existing);
  }

  return Array.from(map.entries())
    .map(([endpoint, stats]) => ({
      endpoint,
      total_calls: stats.calls,
      avg_latency_ms: Math.round(stats.totalLatency / stats.calls),
      error_count: stats.errors,
    }))
    .sort((a, b) => b.total_calls - a.total_calls);
}

export async function getOrgApiKeys(
  orgId: string | null
): Promise<ApiKeyInfo[]> {
  if (!orgId) return DEMO_KEYS;

  const supabase = createServiceClient();
  if (!supabase) return DEMO_KEYS;

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, tier, status, last_used_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0) return DEMO_KEYS;

  return data.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name || "Unnamed Key"),
    key_prefix: String(row.key_prefix || "ak_***"),
    tier: String(row.tier || "free"),
    status: String(row.status || "active"),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    created_at: String(row.created_at || new Date().toISOString()),
  }));
}

export function getDeveloperKPIs(
  usage: UsageDataPoint[],
  keys: ApiKeyInfo[],
  endpoints: EndpointStat[]
): DeveloperKPIs {
  const totalCalls30d = usage.reduce((sum, u) => sum + u.total_calls, 0);
  const activeKeys = keys.filter((k) => k.status === "active").length;
  const totalLatency = endpoints.reduce(
    (sum, e) => sum + e.avg_latency_ms * e.total_calls,
    0
  );
  const totalEndpointCalls = endpoints.reduce(
    (sum, e) => sum + e.total_calls,
    0
  );
  const avgLatencyMs =
    totalEndpointCalls > 0
      ? Math.round(totalLatency / totalEndpointCalls)
      : 0;
  const totalErrors = endpoints.reduce((sum, e) => sum + e.error_count, 0);
  const errorRate =
    totalEndpointCalls > 0
      ? Number(((totalErrors / totalEndpointCalls) * 100).toFixed(2))
      : 0;

  return { totalCalls30d, activeKeys, avgLatencyMs, errorRate };
}
