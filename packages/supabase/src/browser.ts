import { createBrowserClient as createClient } from "@supabase/ssr";

// Browser-side client with anon key — uses cookie-based auth via @supabase/ssr
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}
