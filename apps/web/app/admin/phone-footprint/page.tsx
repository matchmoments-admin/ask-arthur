// /admin/phone-footprint — Phone Footprint ops panel.
//
// Pure server-component dashboard over:
//   - v_phone_footprint_metrics (daily volume, band distribution)
//   - cost_telemetry WHERE feature='phone_footprint' (daily provider spend)
//   - telco_api_usage (Vonage provider health: status mix + avg latency)
//   - Recent phone_footprints (operational tail — did anything just happen?)
//
// Admin auth only via the existing requireAdmin() cookie pattern. No
// direct write capability — this is read-only observability; writes
// happen via Inngest / the API routes. Feature-flag gated by the same
// pattern as other admin pages (the admin area itself sits behind
// NEXT_PUBLIC_FF_BILLING / ADMIN_SECRET; Phone Footprint panel just
// shows empty state when the tables have no rows).

import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";

export const dynamic = "force-dynamic";

interface MetricsRow {
  day: string;
  tier_generated: string;
  anon_lookups: number;
  user_lookups: number;
  fleet_lookups: number;
  avg_score: number;
  high_count: number;
  critical_count: number;
}

interface CostRow {
  day: string;
  provider: string;
  event_count: number;
  total_cost_usd: number;
}

interface TelcoRow {
  provider: string;
  status: string;
  count: number;
  avg_latency_ms: number | null;
}

interface RecentRow {
  id: number;
  msisdn_e164: string;
  tier_generated: string;
  composite_score: number;
  band: string;
  providers_used: string[];
  generated_at: string;
}

function thirtyDaysAgo(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0];
}

function sevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

export default async function AdminPhoneFootprint() {
  await requireAdmin();

  const supa = createServiceClient();
  let metrics: MetricsRow[] = [];
  let costs: CostRow[] = [];
  let telco: TelcoRow[] = [];
  let recent: RecentRow[] = [];

  if (supa) {
    const { data: m } = await supa
      .from("v_phone_footprint_metrics")
      .select("*")
      .gte("day", thirtyDaysAgo())
      .order("day", { ascending: false });
    metrics = (m ?? []) as MetricsRow[];

    const { data: c } = await supa
      .from("cost_telemetry")
      .select("created_at, provider, estimated_cost_usd")
      .eq("feature", "phone_footprint")
      .gte("created_at", sevenDaysAgoIso());

    // Aggregate cost_telemetry rows to (day, provider).
    const byKey = new Map<string, CostRow>();
    for (const r of c ?? []) {
      const day = (r.created_at as string).split("T")[0];
      const key = `${day}|${r.provider}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.event_count += 1;
        existing.total_cost_usd += Number(r.estimated_cost_usd ?? 0);
      } else {
        byKey.set(key, {
          day,
          provider: String(r.provider),
          event_count: 1,
          total_cost_usd: Number(r.estimated_cost_usd ?? 0),
        });
      }
    }
    costs = [...byKey.values()].sort((a, b) => b.day.localeCompare(a.day));

    const { data: t } = await supa
      .from("telco_api_usage")
      .select("provider, status, latency_ms")
      .gte("created_at", sevenDaysAgoIso());

    const tKey = new Map<string, { provider: string; status: string; count: number; latency_sum: number; latency_n: number }>();
    for (const r of t ?? []) {
      const key = `${r.provider}|${r.status}`;
      const existing = tKey.get(key);
      const latency = Number(r.latency_ms ?? 0);
      if (existing) {
        existing.count += 1;
        existing.latency_sum += latency;
        existing.latency_n += latency > 0 ? 1 : 0;
      } else {
        tKey.set(key, {
          provider: String(r.provider),
          status: String(r.status),
          count: 1,
          latency_sum: latency,
          latency_n: latency > 0 ? 1 : 0,
        });
      }
    }
    telco = [...tKey.values()].map((x) => ({
      provider: x.provider,
      status: x.status,
      count: x.count,
      avg_latency_ms: x.latency_n > 0 ? Math.round(x.latency_sum / x.latency_n) : null,
    }));

    const { data: r } = await supa
      .from("phone_footprints")
      .select("id, msisdn_e164, tier_generated, composite_score, band, providers_used, generated_at")
      .order("generated_at", { ascending: false })
      .limit(25);
    recent = (r ?? []) as RecentRow[];
  }

  const today = metrics.slice(0, 5);
  const totalCostToday = costs
    .filter((c) => c.day === new Date().toISOString().split("T")[0])
    .reduce((a, b) => a + b.total_cost_usd, 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-xs font-medium tracking-wider uppercase text-gray-500">
            Admin
          </p>
          <h1 className="font-serif text-2xl text-gray-900">Phone Footprint</h1>
          <p className="mt-1 text-sm text-gray-600">
            Live volume, per-provider cost, Vonage health, recent lookups.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Today&rsquo;s total</p>
          <p className="text-2xl font-bold tabular-nums text-gray-900">
            ${totalCostToday.toFixed(2)} USD
          </p>
        </div>
      </header>

      {/* Volume panel */}
      <section className="mb-10" aria-labelledby="volume-h">
        <h2 id="volume-h" className="mb-3 text-sm font-semibold text-gray-700">
          Volume — last 30 days
        </h2>
        {metrics.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            No footprints yet. Flip <code>NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER</code> once dogfood is ready.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium tracking-wider uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2 text-right">Anon</th>
                  <th className="px-3 py-2 text-right">Users</th>
                  <th className="px-3 py-2 text-right">Fleet</th>
                  <th className="px-3 py-2 text-right">Avg score</th>
                  <th className="px-3 py-2 text-right">High</th>
                  <th className="px-3 py-2 text-right">Critical</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {metrics.map((m, i) => (
                  <tr key={`${m.day}-${m.tier_generated}-${i}`}>
                    <td className="px-3 py-2">{m.day}</td>
                    <td className="px-3 py-2 text-gray-600">{m.tier_generated}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.anon_lookups}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.user_lookups}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.fleet_lookups}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.avg_score}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-orange-700">{m.high_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">{m.critical_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cost panel */}
      <section className="mb-10" aria-labelledby="cost-h">
        <h2 id="cost-h" className="mb-3 text-sm font-semibold text-gray-700">
          Cost — last 7 days by provider
        </h2>
        {costs.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            No cost telemetry yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium tracking-wider uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2 text-right">Events</th>
                  <th className="px-3 py-2 text-right">Cost USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {costs.map((c, i) => (
                  <tr key={`${c.day}-${c.provider}-${i}`}>
                    <td className="px-3 py-2">{c.day}</td>
                    <td className="px-3 py-2 text-gray-600">{c.provider}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.event_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">${c.total_cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Telco provider health (Vonage mainly) */}
      <section className="mb-10" aria-labelledby="telco-h">
        <h2 id="telco-h" className="mb-3 text-sm font-semibold text-gray-700">
          Telco providers — last 7 days
        </h2>
        {telco.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            No Vonage traffic yet. Once <code>FF_VONAGE_ENABLED=true</code>, calls land in <code>telco_api_usage</code>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium tracking-wider uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-right">Avg latency (ms)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {telco.map((t, i) => (
                  <tr key={`${t.provider}-${t.status}-${i}`}>
                    <td className="px-3 py-2 text-gray-600">{t.provider}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          t.status === "ok"
                            ? "rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-green-700"
                            : "rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-orange-700"
                        }
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.avg_latency_ms ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent tail */}
      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-3 text-sm font-semibold text-gray-700">
          Recent 25 lookups
        </h2>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            No lookups yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium tracking-wider uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2">Generated</th>
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2">Band</th>
                  <th className="px-3 py-2">Providers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(r.generated_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.msisdn_e164}</td>
                    <td className="px-3 py-2 text-gray-600">{r.tier_generated}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.composite_score}</td>
                    <td className="px-3 py-2">{r.band}</td>
                    <td className="px-3 py-2 text-gray-600">{r.providers_used.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-gray-500">
          Today = {today.length ? today.map((t) => `${t.tier_generated}:${(t.anon_lookups ?? 0) + (t.user_lookups ?? 0) + (t.fleet_lookups ?? 0)}`).join(", ") : "no rows"}
        </p>
      </section>
    </main>
  );
}
