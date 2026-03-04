import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/**
 * Create a Supabase client for use in Next.js edge middleware.
 * Reads/writes auth cookies on both request and response objects.
 */
export function createMiddlewareClient(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request: req });

  if (!url || !anonKey) {
    return { supabase: null, response };
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Update request cookies for downstream middleware/routes
        for (const { name, value } of cookiesToSet) {
          req.cookies.set(name, value);
        }
        // Recreate response to capture updated request cookies
        response = NextResponse.next({ request: req });
        // Set cookies on response for the browser
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return { supabase, response };
}
