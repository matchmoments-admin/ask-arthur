import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { validateExtensionRequest } from "../_lib/auth";

export async function GET(req: NextRequest) {
  const auth = await validateExtensionRequest(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: auth.error },
      {
        status: auth.status,
        ...(auth.retryAfter && { headers: { "Retry-After": auth.retryAfter } }),
      }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ tier: "free", status: "active" });
  }

  try {
    const { data, error } = await supabase.rpc("get_extension_tier", {
      p_install_id: auth.installId,
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
