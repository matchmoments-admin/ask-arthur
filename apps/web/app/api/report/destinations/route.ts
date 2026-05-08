import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

/**
 * GET /api/report/destinations
 *
 * Returns the dynamic destination list for the onward-reporting picker.
 * Driven by the v119 get_onward_destinations RPC — adding a brand to
 * known_brands surfaces it here automatically.
 *
 * Query params:
 *   scamType, impersonatedBrand, channel: scam_reports columns
 *   hasFinancialLoss, hasPiiCompromise: 'true' | 'false'
 */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  const { data, error } = await supabase.rpc("get_onward_destinations", {
    p_scam_type: u.searchParams.get("scamType") || null,
    p_impersonated_brand: u.searchParams.get("impersonatedBrand") || null,
    p_channel: u.searchParams.get("channel") || null,
    p_has_financial_loss: u.searchParams.get("hasFinancialLoss") === "true",
    p_has_pii_compromise: u.searchParams.get("hasPiiCompromise") === "true",
  });

  if (error) {
    logger.error("get_onward_destinations failed", { error: String(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ destinations: data ?? [] });
}
