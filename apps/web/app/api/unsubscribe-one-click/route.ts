import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { logger } from "@askarthur/utils/logger";

// RFC 8058 one-click unsubscribe endpoint
// Email clients POST to this URL to unsubscribe the user
export async function POST(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  const token = req.nextUrl.searchParams.get("token");

  // Always return 200 per RFC 8058 — don't reveal subscription status
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return new NextResponse(null, { status: 200 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return new NextResponse(null, { status: 200 });
  }

  const { error } = await supabase
    .from("email_subscribers")
    .update({ is_active: false })
    .eq("email", email);

  if (error) {
    logger.error("One-click unsubscribe error", { error: String(error) });
  }

  return new NextResponse(null, { status: 200 });
}
