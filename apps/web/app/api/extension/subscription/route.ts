import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { EXTENSION_TIER_LIMITS } from "@askarthur/types/billing";
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
    return NextResponse.json({ tier: "free", status: "active", limits: EXTENSION_TIER_LIMITS.free });
  }

  try {
    const { data, error } = await supabase.rpc("get_extension_tier", {
      p_install_id: auth.installId,
    });

    if (error) {
      logger.error("Failed to check extension tier", { error });
      return NextResponse.json({ tier: "free", status: "active", limits: EXTENSION_TIER_LIMITS.free });
    }

    const tier = data === "pro" ? "pro" : "free";
    return NextResponse.json({
      tier,
      status: "active",
      // Popup renders quota context (checks/day, image checks/day) without
      // hardcoding tier shapes client-side.
      limits: EXTENSION_TIER_LIMITS[tier],
    });
  } catch (err) {
    logger.error("Extension subscription check error", { error: err });
    return NextResponse.json({ tier: "free", status: "active", limits: EXTENSION_TIER_LIMITS.free });
  }
}
