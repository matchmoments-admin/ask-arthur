import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import BrandAlertsDashboard from "./BrandAlertsDashboard";

function sevenDaysAgoIsoDate(): string {
  return new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
}

export default async function BrandAlertsPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  let alerts: Array<Record<string, unknown>> = [];
  let totalChecks = 0;

  if (supabase) {
    const { data } = await supabase
      .from("brand_impersonation_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    alerts = data || [];

    const { data: stats } = await supabase
      .from("check_stats")
      .select("total_checks")
      .gte("date", sevenDaysAgoIsoDate());

    totalChecks = (stats || []).reduce((sum: number, r: Record<string, unknown>) => sum + ((r.total_checks as number) || 0), 0);
  }

  return (
    <div className="max-w-4xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">Brand Intelligence</h1>
      <p className="text-gov-slate text-sm mb-6">
        Weekly scam intelligence summaries. Generate social posts and brand reports.
      </p>
      <BrandAlertsDashboard initialAlerts={alerts} totalChecks={totalChecks} />
    </div>
  );
}
