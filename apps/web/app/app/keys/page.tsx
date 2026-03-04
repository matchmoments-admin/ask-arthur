import { requireAuth } from "@/lib/auth";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import KeyList from "./KeyList";

export const metadata = {
  title: "API Keys — Ask Arthur",
};

export default async function KeysPage() {
  await requireAuth();
  const supabase = await createAuthServerClient();

  let keys: Array<{
    id: number;
    org_name: string;
    tier: string;
    daily_limit: number;
    is_active: boolean;
    last_used_at: string | null;
    created_at: string;
  }> = [];

  if (supabase) {
    const { data } = await supabase
      .from("api_keys")
      .select(
        "id, org_name, tier, daily_limit, is_active, last_used_at, created_at"
      )
      .order("created_at", { ascending: false });

    if (data) {
      keys = data;
    }
  }

  return (
    <div>
      <h1 className="text-deep-navy text-xl font-extrabold mb-6">API Keys</h1>
      <KeyList initialKeys={keys} />
    </div>
  );
}
