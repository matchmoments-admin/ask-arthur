import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import AnalyticsDashboard from "./AnalyticsDashboard";

export const dynamic = "force-dynamic";

interface DayScan {
  day: string;
  scans: number;
}
interface TypeScan {
  day: string;
  input_type: string | null;
  scans: number;
}
interface NoScanRow {
  day: string;
  no_scan_visitors: number;
  total_visitors: number;
  no_scan_pct: number | null;
}
interface AttributedRow {
  event_type: string;
  source: string;
  medium: string | null;
  campaign: string | null;
  week: string;
  conversions: number;
}

function thirtyDaysAgoIsoDate(): string {
  return new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
}

// Wrapped so the react-hooks/purity lint rule doesn't flag a bare Date.now()
// in render — same pattern as /admin/costs.
function getNowMs(): number {
  return Date.now();
}

export default async function AnalyticsPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  let dailyScans: DayScan[] = [];
  let scansByType: TypeScan[] = [];
  let noScanRate: NoScanRow[] = [];
  let attributed: AttributedRow[] = [];
  let contentReaders = 0;
  let readersWhoScanned = 0;

  if (supabase) {
    const since = thirtyDaysAgoIsoDate();

    const [ds, sbt, nsr, uac, funnel] = await Promise.all([
      supabase.from("daily_scans").select("day, scans").gte("day", since).order("day", { ascending: false }),
      supabase.from("scans_by_type").select("day, input_type, scans").gte("day", since),
      supabase.from("no_scan_visitor_rate").select("day, no_scan_visitors, total_visitors, no_scan_pct").gte("day", since).order("day", { ascending: false }),
      supabase.from("utm_attributed_conversions").select("event_type, source, medium, campaign, week, conversions").order("week", { ascending: false }).limit(200),
      supabase.from("blog_to_scan_funnel").select("content_readers, readers_who_scanned").single(),
    ]);

    dailyScans = (ds.data ?? []).map((r) => ({ day: r.day as string, scans: Number(r.scans) }));
    scansByType = (sbt.data ?? []).map((r) => ({
      day: r.day as string,
      input_type: (r.input_type as string | null) ?? "unknown",
      scans: Number(r.scans),
    }));
    noScanRate = (nsr.data ?? []).map((r) => ({
      day: r.day as string,
      no_scan_visitors: Number(r.no_scan_visitors),
      total_visitors: Number(r.total_visitors),
      no_scan_pct: r.no_scan_pct === null ? null : Number(r.no_scan_pct),
    }));
    attributed = (uac.data ?? []).map((r) => ({
      event_type: r.event_type as string,
      source: r.source as string,
      medium: (r.medium as string | null) ?? null,
      campaign: (r.campaign as string | null) ?? null,
      week: r.week as string,
      conversions: Number(r.conversions),
    }));
    contentReaders = Number(funnel.data?.content_readers ?? 0);
    readersWhoScanned = Number(funnel.data?.readers_who_scanned ?? 0);
  }

  // --- Derived headline metrics (last 7 days) --------------------------------
  const now = getNowMs();
  const dayMs = 86400000;
  const within = (dayStr: string, startMs: number) =>
    new Date(dayStr + "T00:00:00Z").getTime() >= startMs;
  const sevenDaysAgo = now - 7 * dayMs;

  const scans7 = dailyScans
    .filter((r) => within(r.day, sevenDaysAgo))
    .reduce((s, r) => s + r.scans, 0);

  // Activation = 1 − no-scan rate, averaged over the last 7 days' visitor days.
  const recentNoScan = noScanRate.filter((r) => within(r.day, sevenDaysAgo));
  const totalVisitors7 = recentNoScan.reduce((s, r) => s + r.total_visitors, 0);
  const noScanVisitors7 = recentNoScan.reduce((s, r) => s + r.no_scan_visitors, 0);
  const noScanPct7 = totalVisitors7 === 0 ? null : (100 * noScanVisitors7) / totalVisitors7;
  const activationPct7 = noScanPct7 === null ? null : 100 - noScanPct7;

  const b2bLeads7 = attributed
    .filter((r) => r.event_type === "contact_submit" && within(r.week, now - 7 * dayMs))
    .reduce((s, r) => s + r.conversions, 0);

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">Analytics &amp; attribution</h1>
      <p className="text-gov-slate text-sm mb-6">
        First-party owned event store. Rows are written fire-and-forget by
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">logEvent()</code>
        and stamped with each visitor&apos;s write-once first-touch attribution. Metadata only — no
        scanned content. Populates once
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">FF_ANALYTICS_ATTRIBUTION</code>
        is on.
      </p>
      <AnalyticsDashboard
        scans7={scans7}
        activationPct7={activationPct7}
        noScanPct7={noScanPct7}
        b2bLeads7={b2bLeads7}
        contentReaders={contentReaders}
        readersWhoScanned={readersWhoScanned}
        dailyScans={dailyScans}
        scansByType={scansByType}
        noScanRate={noScanRate}
        attributed={attributed}
      />
    </div>
  );
}
