import { createBrowserClient as createClient } from "@supabase/ssr";
import type { Database } from "@askarthur/types/db";

// Browser-side client with anon key — uses cookie-based auth via @supabase/ssr
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient<Database>(url, key);
}
