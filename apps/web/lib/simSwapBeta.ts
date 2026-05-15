import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

// Private-beta invite gate. Backed by the `sim_swap_beta_invites` table
// shipped in migration v123. A user is in the beta iff they hold a row
// with redeemed_by = auth.uid() and redeemed_at IS NOT NULL.
//
// Read-only contract — redemption itself lives in the
// /api/sim-swap/invites/redeem endpoint, which writes the row.
//
// Helper goal: ONE place that all SIM Swap endpoints + pages query,
// so the beta admission rule never drifts between surfaces.

export async function hasRedeemedSimSwapInvite(
  userId: string,
): Promise<boolean> {
  const supa = createServiceClient();
  if (!supa) {
    // Fail-closed in production — a Supabase outage must NOT open the
    // private-beta gate. Caller will see the same `invite_required`
    // failure mode it would for a real not-in-beta user.
    logger.warn("sim-swap invite check: supabase unavailable; fail-closed");
    return false;
  }
  try {
    const { data, error } = await supa
      .from("sim_swap_beta_invites")
      .select("invite_code")
      .eq("redeemed_by", userId)
      .not("redeemed_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.warn("sim-swap invite check error", { error });
      return false;
    }
    return Boolean(data);
  } catch (err) {
    logger.warn("sim-swap invite check threw", { error: String(err) });
    return false;
  }
}
