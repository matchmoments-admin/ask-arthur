import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import BrandAlertsList from "./BrandAlertsList";

export default async function BrandAlertsPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  let alerts: Array<Record<string, unknown>> = [];

  if (supabase) {
    const { data } = await supabase
      .from("brand_impersonation_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    alerts = data || [];
  }

  return (
    <div className="max-w-4xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">Brand Impersonation Alerts</h1>
      <p className="text-gov-slate text-sm mb-6">
        Review and publish social media alerts when brands are impersonated in scams.
      </p>

      {alerts.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          No brand alerts yet. Alerts are auto-created when scam submissions detect brand impersonation.
        </div>
      ) : (
        <BrandAlertsList initialAlerts={alerts} />
      )}
    </div>
  );
}
