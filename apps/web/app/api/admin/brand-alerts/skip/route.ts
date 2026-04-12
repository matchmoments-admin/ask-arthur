import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";

export async function POST(req: NextRequest) {
  const adminCookie = req.cookies.get("__aa_admin")?.value;
  if (!adminCookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { alertId } = await req.json();
  if (!alertId) {
    return NextResponse.json({ error: "Missing alertId" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (supabase) {
    await supabase
      .from("brand_impersonation_alerts")
      .update({ outreach_status: "skipped" })
      .eq("id", alertId);
  }

  return NextResponse.json({ skipped: true });
}
