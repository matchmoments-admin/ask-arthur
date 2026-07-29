import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";

import { AuthUnavailableError, getSupabaseUserOrThrow } from "@/lib/auth";

/**
 * Authenticated threat-feed widget data for the signed-in dashboard.
 *
 * SECURITY (2026-07-29): this handler previously carried a comment asserting
 * that "dashboard routes are behind auth in layout" and then performed no auth
 * check at all. `middleware.ts` protects the `/app` and `/admin` *pages*, but
 * `/api/*` gets rate limiting only — so this route served raw
 * `scam_entities.normalized_value` (AU phone numbers, scammer domains and
 * URLs) to unauthenticated callers over the service-role client, routing
 * around the v172 RLS fix that closed the same exposure at the table level.
 *
 * Two controls now apply, and both are load-bearing:
 *  1. A real session check — the layout is not an access control for an API route.
 *  2. `normalized_value` is never selected. The widget renders type / risk /
 *     counts, so the raw identifier was never needed. Keeping it out of the
 *     projection means a future auth regression cannot re-leak the identifiers.
 */
export async function GET(req: NextRequest) {
  const authClient = await createAuthServerClient();
  if (!authClient) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
  }

  let user;
  try {
    user = await getSupabaseUserOrThrow(authClient);
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json(
        { error: "auth_unavailable", retryAfterSec: 30 },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 50);

  // NOTE: `normalized_value` is deliberately excluded — see the header comment.
  const { data, error } = await supabase
    .from("scam_entities")
    .select("id, entity_type, report_count, risk_level, risk_score, last_seen, first_seen")
    .order("last_seen", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  return NextResponse.json(data || [], {
    headers: { "Cache-Control": "no-store" },
  });
}
