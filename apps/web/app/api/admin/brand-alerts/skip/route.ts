import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";

export async function POST(req: NextRequest) {
  // Dual-mode auth (map #939 / #942): the old raw verifyAdminToken check
  // had no Supabase-admin path.
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
