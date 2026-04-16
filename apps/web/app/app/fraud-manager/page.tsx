import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { createServiceClient } from "@askarthur/supabase/server";
import FraudManagerClient from "./FraudManagerClient";

export const metadata = {
  title: "Fraud Manager — Ask Arthur",
};

export default async function FraudManagerPage() {
  const user = await requireAuth();
  const org = await getOrg(user.id);

  const supabase = createServiceClient();

  let recentHighRisk: Array<{
    normalized_value: string;
    entity_type: string;
    risk_score: number;
    risk_level: string;
    report_count: number;
    last_seen: string;
  }> = [];
  let alertCount = 0;

  if (supabase) {
    const { data } = await supabase
      .from("scam_entities")
      .select(
        "normalized_value, entity_type, risk_score, risk_level, report_count, last_seen"
      )
      .in("risk_level", ["CRITICAL", "HIGH"])
      .order("last_seen", { ascending: false })
      .limit(10);

    recentHighRisk = data ?? [];

    const { count } = await supabase
      .from("scam_entities")
      .select("*", { count: "exact", head: true })
      .gte("last_seen", new Date(Date.now() - 86400000).toISOString());

    alertCount = count ?? 0;
  }

  return (
    <FraudManagerClient
      initialHighRisk={recentHighRisk}
      alertCount={alertCount}
      orgName={org?.orgName ?? null}
    />
  );
}
