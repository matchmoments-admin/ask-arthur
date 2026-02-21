import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// RFC 8058 one-click unsubscribe endpoint
// Email clients POST to this URL to unsubscribe the user
export async function POST(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
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
    return NextResponse.json({ error: "Failed to unsubscribe" }, { status: 500 });
  }

  return new NextResponse(null, { status: 200 });
}
