import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export async function GET(req: NextRequest) {
  const installId = req.nextUrl.searchParams.get("installId");
  if (!installId || installId.length < 10) {
    return NextResponse.json(
      { error: "Missing or invalid installId" },
      { status: 400 }
    );
  }

  // Validate extension secret
  const secret = req.headers.get("x-extension-secret");
  const expectedSecret = process.env.EXTENSION_SECRET;

  if (expectedSecret && (!secret || secret !== expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    // No DB — default to free tier
    return NextResponse.json({ tier: "free", status: "active" });
  }

  try {
    const { data, error } = await supabase.rpc("get_extension_tier", {
      p_install_id: installId,
    });

    if (error) {
      logger.error("Failed to check extension tier", { error });
      return NextResponse.json({ tier: "free", status: "active" });
    }

    return NextResponse.json({
      tier: data ?? "free",
      status: "active",
    });
  } catch (err) {
    logger.error("Extension subscription check error", { error: err });
    return NextResponse.json({ tier: "free", status: "active" });
  }
}
