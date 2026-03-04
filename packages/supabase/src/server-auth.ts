import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * User-context Supabase client for Server Components and API routes.
 * Respects RLS — queries scoped to the authenticated user.
 * Distinct from createServiceClient() which bypasses RLS.
 */
export async function createAuthServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll is called from Server Components where cookies can't be set.
          // This is expected — the middleware handles token refresh.
        }
      },
    },
  });
}
