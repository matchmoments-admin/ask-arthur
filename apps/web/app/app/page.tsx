import { requireAuth } from "@/lib/auth";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import Link from "next/link";

export default async function DashboardPage() {
  const user = await requireAuth();
  const supabase = await createAuthServerClient();

  let keyCount = 0;
  let activeSubscription: { plan: string; status: string } | null = null;

  if (supabase) {
    const { count } = await supabase
      .from("api_keys")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    keyCount = count ?? 0;

    const { data: subs } = await supabase
      .from("subscriptions")
      .select("plan, status")
      .in("status", ["active", "trialing"])
      .limit(1);

    if (subs && subs.length > 0) {
      activeSubscription = subs[0];
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-deep-navy text-xl font-extrabold mb-1">
          Welcome{user.displayName ? `, ${user.displayName}` : ""}
        </h1>
        <p className="text-gov-slate text-sm">{user.email}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* API Keys card */}
        <div className="rounded-xl border border-border-light bg-white p-5">
          <p className="text-gov-slate text-xs font-bold uppercase tracking-wider mb-1">
            Active API Keys
          </p>
          <p className="text-deep-navy text-2xl font-extrabold">{keyCount}</p>
          <Link
            href="/app/keys"
            className="text-action-teal text-sm font-bold hover:underline mt-2 inline-block"
          >
            Manage keys
          </Link>
        </div>

        {/* Plan card */}
        <div className="rounded-xl border border-border-light bg-white p-5">
          <p className="text-gov-slate text-xs font-bold uppercase tracking-wider mb-1">
            Current Plan
          </p>
          <p className="text-deep-navy text-2xl font-extrabold capitalize">
            {activeSubscription?.plan ?? "Free"}
          </p>
          <Link
            href="/app/billing"
            className="text-action-teal text-sm font-bold hover:underline mt-2 inline-block"
          >
            {activeSubscription ? "Manage billing" : "Upgrade"}
          </Link>
        </div>
      </div>

      {keyCount === 0 && (
        <div className="rounded-xl border border-border-light bg-slate-50 p-5 text-center">
          <p className="text-gov-slate text-sm mb-3">
            Get started by creating your first API key.
          </p>
          <Link
            href="/app/keys"
            className="inline-block rounded-lg bg-action-teal text-white font-bold text-sm px-5 py-2.5 hover:bg-action-teal/90 transition-colors"
          >
            Create API Key
          </Link>
        </div>
      )}
    </div>
  );
}
