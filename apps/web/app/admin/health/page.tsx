import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import {
  getQueueCounts,
  getOldestPendingMinutes,
  getRecentFeedRuns,
  getArchiveStats,
  getStripeEventStats,
} from "@/lib/dashboard/admin-health";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  await requireAdmin();
  const svc = createServiceClient();

  const [queue, oldestPendingMinutes, feedRuns, archive, stripeStats] = await Promise.all([
    getQueueCounts(svc),
    getOldestPendingMinutes(svc),
    getRecentFeedRuns(svc),
    getArchiveStats(svc),
    getStripeEventStats(svc),
  ]);

  // Async Server Component: this function executes once per request, not on
  // every React render, so Date.now() here is deterministic for the response.
  // The react-hooks/purity rule can't tell the difference, so disable inline.
  const feedStale = feedRuns.filter((r) => {
    if (!r.started_at) return true;
    // eslint-disable-next-line react-hooks/purity
    const ageHours = (Date.now() - new Date(r.started_at).getTime()) / 3_600_000;
    return ageHours > 36 || r.status === "error";
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 font-sans text-slate-800">
      <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
      <p className="mt-1 text-sm text-slate-500">
        Operational surface for queue, feeds, archive, and Stripe idempotency.
      </p>

      <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Queue pending" value={queue.pending} warn={queue.pending > 100} />
        <Stat label="Queue processing" value={queue.processing} warn={queue.processing > 20} />
        <Stat label="Queue failed" value={queue.failed} warn={queue.failed > 0} />
        <Stat
          label="Oldest pending (min)"
          value={oldestPendingMinutes ?? "—"}
          warn={(oldestPendingMinutes ?? 0) > 15}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Archive</h2>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <Stat label="scam_reports (hot)" value={archive.hot.toLocaleString()} />
          <Stat label="scam_reports_archive" value={archive.archived.toLocaleString()} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Stripe events (7d)</h2>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <Stat label="Received" value={stripeStats.total} />
          <Stat label="Unprocessed" value={stripeStats.unprocessed} warn={stripeStats.unprocessed > 0} />
        </div>
        {stripeStats.recent.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
            {stripeStats.recent.map((e, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2">
                <span className="font-mono text-xs text-slate-700">{e.event_type}</span>
                <span className="text-xs text-slate-400">
                  {new Date(e.received_at).toLocaleString()}
                </span>
                <span className={`text-xs ${e.processed_at ? "text-emerald-600" : "text-amber-600"}`}>
                  {e.processed_at ? "processed" : "pending"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Feed freshness</h2>
        {feedStale.length === 0 ? (
          <p className="mt-2 text-sm text-emerald-600">All feeds ran in the last 36h.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-amber-200 bg-amber-50 text-sm">
            {feedStale.map((r, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2">
                <span className="font-mono text-xs">{r.feed_name}</span>
                <span className="text-xs text-slate-500">
                  {r.started_at ? new Date(r.started_at).toLocaleString() : "never run"}
                </span>
                <span className="text-xs text-amber-700">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Showing the most recent run per feed that is older than 36 hours or ended in error.
        </p>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number | string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-4 py-3 ${
        warn ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${warn ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}
