import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import BrandAlertsDashboard from "./BrandAlertsDashboard";
import QueryErrorBand from "@/components/admin/QueryErrorBand";

function sevenDaysAgoIsoDate(): string {
  return new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
}

export default async function BrandAlertsPage() {
  await requireAdmin();

  // #945: a failed query must never render as a healthy empty state.
  const loadErrors: string[] = [];

  const supabase = createServiceClient();
  let alerts: Array<Record<string, unknown>> = [];
  let totalChecks = 0;

  if (supabase) {
    const { data, error: qe1 } = await supabase
      .from("brand_impersonation_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (qe1 && qe1.code !== "PGRST116") loadErrors.push("page data");

    alerts = data || [];

    // gt, not gte: the boundary date is "today minus 7 days" — including it
    // makes an 8-calendar-date "week" (#941 finding 11, the 8-vs-7 class).
    const { data: stats, error: qe2 } = await supabase
      .from("check_stats")
      .select("total_checks")
      .gt("date", sevenDaysAgoIsoDate());
    if (qe2 && qe2.code !== "PGRST116") loadErrors.push("check stats");

    totalChecks = (stats || []).reduce((sum: number, r: Record<string, unknown>) => sum + ((r.total_checks as number) || 0), 0);
  }

  return (
    <div className="max-w-4xl mx-auto px-5 py-8">
      <QueryErrorBand errors={loadErrors} />
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">Brand Intelligence</h1>
      <p className="text-gov-slate text-sm mb-6">
        Weekly scam intelligence summaries. Generate social posts and brand reports.
      </p>
      <BrandAlertsDashboard initialAlerts={alerts} totalChecks={totalChecks} />
    </div>
  );
}
