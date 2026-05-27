import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/**
 * Create a Supabase client for use in Next.js edge middleware.
 * Reads/writes auth cookies on both request and response objects.
 *
 * `requestHeaders` (optional): a Headers object the caller wants
 * propagated to downstream route handlers via `NextResponse.next({
 * request: { headers } })`. The cookie-refresh path inside `setAll`
 * also uses these so a refreshed-cookie response carries the same
 * headers — important when the middleware is propagating a request-id
 * for cross-system tracing.
 */
export function createMiddlewareClient(
  req: NextRequest,
  requestHeaders?: Headers,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const nextOptions = requestHeaders
    ? { request: { headers: requestHeaders } }
    : { request: req };

  let response = NextResponse.next(nextOptions);

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
        // Recreate response to capture updated request cookies — must
        // re-use `nextOptions` (not `request: req`) so any caller-
        // supplied requestHeaders survive the cookie-refresh rebuild.
        response = NextResponse.next(nextOptions);
        // Set cookies on response for the browser
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return { supabase, response };
}
