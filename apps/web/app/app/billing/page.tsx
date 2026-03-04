import { requireAuth } from "@/lib/auth";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { redirect } from "next/navigation";
import BillingManager from "./BillingManager";

export const metadata = {
  title: "Billing — Ask Arthur",
};

export default async function BillingPage() {
  const user = await requireAuth();

  if (!featureFlags.billing) {
    redirect("/app");
  }

  const supabase = await createAuthServerClient();

  let keys: Array<{
    id: number;
    org_name: string;
    tier: string;
  }> = [];

  let subscriptions: Array<{
    id: number;
    api_key_id: number;
    plan: string;
    status: string;
    paddle_subscription_id: string;
    current_period_end: string | null;
  }> = [];

  if (supabase) {
    const { data: keyData } = await supabase
      .from("api_keys")
      .select("id, org_name, tier")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (keyData) keys = keyData;

    const { data: subData } = await supabase
      .from("subscriptions")
      .select(
        "id, api_key_id, plan, status, paddle_subscription_id, current_period_end"
      )
      .order("created_at", { ascending: false });

    if (subData) subscriptions = subData;
  }

  return (
    <div>
      <h1 className="text-deep-navy text-xl font-extrabold mb-6">Billing</h1>
      <BillingManager
        userId={user.id}
        userEmail={user.email}
        keys={keys}
        subscriptions={subscriptions}
      />
    </div>
  );
}
