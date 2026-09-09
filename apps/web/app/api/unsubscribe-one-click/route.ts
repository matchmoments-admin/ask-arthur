import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { logger } from "@askarthur/utils/logger";

// RFC 8058 one-click unsubscribe endpoint
// Email clients POST to this URL to unsubscribe the user
export async function POST(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  const token = req.nextUrl.searchParams.get("token");

  // Invalid tokens do not disclose status; storage failures must be retryable.
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return new NextResponse(null, { status: 200 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return new NextResponse(null, { status: 503, headers: { "Retry-After": "60" } });
  }

  const { error } = await supabase.rpc("unsubscribe_newsletter", { p_email: email });

  if (error) {
    logger.error("One-click unsubscribe storage failed");
    return new NextResponse(null, { status: 503, headers: { "Retry-After": "60" } });
  }

  return new NextResponse(null, { status: 200 });
}
