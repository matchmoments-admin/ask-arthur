import { createClient } from "@supabase/supabase-js";

// Server-side client with service role key (for API routes)
// Returns null when credentials are missing (local dev mock mode)
export function createServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key);
}
