import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import CloneWatchTriage, { type PendingAlert } from "./CloneWatchTriage";

export const dynamic = "force-dynamic";

export default async function CloneWatchAdminPage() {
  await requireAdmin();

  if (!featureFlags.shopfrontCloneOutreach) {
    notFound();
  }

  const supabase = createServiceClient();
  let pending: PendingAlert[] = [];
  let weekly: WeeklySnapshot = EMPTY_WEEKLY;
  let brandBreakdown: BrandBreakdownRow[] = [];
  let takedown: TakedownStats = EMPTY_TAKEDOWN;

  if (supabase) {
    const [pendingRes, weeklyRes, brandRes, takedownRes] = await Promise.all([
      supabase.rpc("list_clone_alerts_pending_triage", { p_limit: 200 }),
      supabase.rpc("clone_watch_weekly_metrics", { p_days: 7 }),
      supabase.rpc("clone_watch_brand_breakdown", { p_days: 30 }),
      supabase.rpc("clone_watch_takedown_stats", { p_days: 30 }),
    ]);
    if (Array.isArray(pendingRes.data)) {
      pending = pendingRes.data as PendingAlert[];
    }
    if (Array.isArray(weeklyRes.data) && weeklyRes.data[0]) {
      weekly = weeklyRes.data[0] as WeeklySnapshot;
    }
    if (Array.isArray(brandRes.data)) {
      brandBreakdown = brandRes.data as BrandBreakdownRow[];
    }
    if (Array.isArray(takedownRes.data) && takedownRes.data[0]) {
      takedown = takedownRes.data[0] as TakedownStats;
    }
  }

  // Captured here (before render) so the per-row age labels are pure.
  // Server Components re-execute fully on each request anyway — Date.now
  // is deterministic for the lifetime of this render. The lint rule is
  // overly broad for SC bodies.
  // eslint-disable-next-line react-hooks/purity
  const computedAt = Date.now();

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">
        Clone-watch triage
      </h1>
      <p className="text-gov-slate text-sm mb-6">
        Daily NRD candidates awaiting human verdict. Mark FP / TP / Investigate.
        TP-confirmed rows fan out to community blocklists + brand notification.
      </p>

      <WeeklyKpis snapshot={weekly} pendingCount={pending.length} />

      <TakedownStatsRow stats={takedown} />

      <CloneWatchTriage initialPending={pending} />

      <BrandBreakdownTable rows={brandBreakdown} computedAt={computedAt} />
    </div>
  );
}

interface WeeklySnapshot {
  candidates_total: number;
  triaged_tp: number;
  triaged_fp: number;
  triaged_investigate: number;
  pending: number;
  brands_touched: number;
  submissions_netcraft: number;
  notifications_sent: number;
}

const EMPTY_WEEKLY: WeeklySnapshot = {
  candidates_total: 0,
  triaged_tp: 0,
  triaged_fp: 0,
  triaged_investigate: 0,
  pending: 0,
  brands_touched: 0,
  submissions_netcraft: 0,
  notifications_sent: 0,
};

function WeeklyKpis({
  snapshot,
  pendingCount,
}: {
  snapshot: WeeklySnapshot;
  pendingCount: number;
}) {
  const tiles: Array<{ label: string; value: number | string }> = [
    { label: "Awaiting triage", value: pendingCount },
    { label: "Candidates (7d)", value: snapshot.candidates_total },
    { label: "TP confirmed", value: snapshot.triaged_tp },
    { label: "FP", value: snapshot.triaged_fp },
    { label: "Brands touched", value: snapshot.brands_touched },
    { label: "Netcraft submits", value: snapshot.submissions_netcraft },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="bg-white border border-border-light rounded-xl shadow-sm p-3"
        >
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {t.label}
          </p>
          <p
            className="text-xl font-bold text-deep-navy"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {t.value}
          </p>
        </div>
      ))}
    </div>
  );
}

interface TakedownStats {
  window_days: number;
  takedowns_total: number;
  median_minutes: number;
  p90_minutes: number;
  fastest_minutes: number;
  slowest_minutes: number;
}

const EMPTY_TAKEDOWN: TakedownStats = {
  window_days: 30,
  takedowns_total: 0,
  median_minutes: 0,
  p90_minutes: 0,
  fastest_minutes: 0,
  slowest_minutes: 0,
};

function TakedownStatsRow({ stats }: { stats: TakedownStats }) {
  if (stats.takedowns_total === 0) {
    return (
      <div className="mb-6 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-500">
        Netcraft takedown data populates once the first TP-confirmed row clears
        Netcraft processing. Polling cron runs every 30 min — see
        <code className="ml-1 px-1.5 py-0.5 bg-white border border-slate-200 rounded">
          shopfront-clone-poll-netcraft
        </code>
        .
      </div>
    );
  }
  const fmt = (m: number) =>
    m < 60 ? `${m} min` : `${(m / 60).toFixed(1)}h`;
  const tiles: Array<{ label: string; value: string }> = [
    { label: "Takedowns recorded (30d)", value: stats.takedowns_total.toLocaleString() },
    { label: "Median time-to-takedown", value: fmt(stats.median_minutes) },
    { label: "P90 time-to-takedown", value: fmt(stats.p90_minutes) },
    { label: "Fastest", value: fmt(stats.fastest_minutes) },
  ];
  return (
    <div className="mb-6 bg-white border border-border-light rounded-xl shadow-sm p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-3">
        Takedown stats · last {stats.window_days} days
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.label}>
            <p
              className="text-xl font-bold text-deep-navy"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t.value}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

interface BrandBreakdownRow {
  brand: string;
  total_candidates: number;
  tp_confirmed: number;
  tp_actioned: number;
  fp: number;
  pending: number;
  netcraft_submits: number;
  brand_notifications: number;
  first_hit_at: string;
  last_hit_at: string;
}

function BrandBreakdownTable({
  rows,
  computedAt,
}: {
  rows: BrandBreakdownRow[];
  computedAt: number;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="mt-8 bg-white border border-border-light rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-deep-navy">
          Per-brand history (30 days)
        </h2>
        <span className="ml-auto text-[11px] text-slate-400">
          {rows.length} brand{rows.length !== 1 ? "s" : ""} with hits
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-50">
              <th className="text-left px-5 py-2">Brand</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2">TP</th>
              <th className="text-right px-3 py-2">FP</th>
              <th className="text-right px-3 py-2">Pending</th>
              <th className="text-right px-3 py-2">FP rate</th>
              <th className="text-right px-3 py-2">Netcraft</th>
              <th className="text-right px-3 py-2">Notified</th>
              <th className="text-right px-5 py-2">Last hit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const triaged = r.tp_confirmed + r.tp_actioned + r.fp;
              const fpRate = triaged > 0 ? Math.round((r.fp / triaged) * 100) : null;
              const tpTotal = r.tp_confirmed + r.tp_actioned;
              const lastHit = new Date(r.last_hit_at);
              const ageMs = computedAt - lastHit.getTime();
              const ageHrs = Math.floor(ageMs / 3600000);
              const ageLabel =
                ageHrs < 24 ? `${ageHrs}h ago` : `${Math.floor(ageHrs / 24)}d ago`;
              return (
                <tr key={r.brand}>
                  <td className="px-5 py-2 font-medium text-deep-navy">
                    {r.brand}
                  </td>
                  <td
                    className="text-right px-3 py-2"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {r.total_candidates}
                  </td>
                  <td
                    className="text-right px-3 py-2 text-rose-700 font-medium"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {tpTotal}
                  </td>
                  <td
                    className="text-right px-3 py-2 text-slate-500"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {r.fp}
                  </td>
                  <td
                    className="text-right px-3 py-2 text-amber-700"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {r.pending}
                  </td>
                  <td
                    className="text-right px-3 py-2 text-slate-400 text-xs"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {fpRate === null ? "—" : `${fpRate}%`}
                  </td>
                  <td
                    className="text-right px-3 py-2"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {r.netcraft_submits}
                  </td>
                  <td
                    className="text-right px-3 py-2"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {r.brand_notifications}
                  </td>
                  <td className="text-right px-5 py-2 text-slate-400 text-xs">
                    {ageLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
