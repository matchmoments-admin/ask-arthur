import { requireAuth } from "@/lib/auth";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { gateOrRedirect } from "@/lib/featureGate";
import BillingManager from "./BillingManager";

export const metadata = {
  title: "Billing — Ask Arthur",
};

// Feature gates must be evaluated per REQUEST, not per build. Without this a
// statically prerendered route bakes the flag's build-time value into HTML: the
// page keeps serving 200 after the flag is turned off, and stays 404 after it is
// turned on until something triggers a rebuild. That is not hypothetical —
// /charity-check served 200 while both of its API routes returned 503
// feature_disabled, so every search a user ran failed. Enforced by
// __tests__/featureGateRuntime.test.ts.
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await requireAuth();

  gateOrRedirect("billing", "/app");

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
    stripe_subscription_id: string | null;
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
        "id, api_key_id, plan, status, stripe_subscription_id, current_period_end"
      )
      .order("created_at", { ascending: false });

    if (subData) subscriptions = subData;
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
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
