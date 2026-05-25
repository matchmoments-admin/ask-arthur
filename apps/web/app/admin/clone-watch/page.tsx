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

  if (supabase) {
    const { data: rows } = await supabase.rpc(
      "list_clone_alerts_pending_triage",
      { p_limit: 200 },
    );
    if (Array.isArray(rows)) {
      pending = rows as PendingAlert[];
    }

    const { data: weeklyRows } = await supabase.rpc(
      "clone_watch_weekly_metrics",
      { p_days: 7 },
    );
    if (Array.isArray(weeklyRows) && weeklyRows[0]) {
      weekly = weeklyRows[0] as WeeklySnapshot;
    }
  }

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

      <CloneWatchTriage initialPending={pending} />
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
