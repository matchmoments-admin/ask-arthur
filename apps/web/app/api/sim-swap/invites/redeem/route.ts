// POST /api/sim-swap/invites/redeem
//
// Single-use invite redemption for the SIM-swap private beta. The user
// arrives at /sim-swap-check with an `?invite=<code>` querystring, signs
// in if not already, then POSTs here to claim the code.
//
// Idempotent: re-POSTing the same code from the same user is a 200 no-op.
// Posting a different user's already-redeemed code returns 410 Gone.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { getUser, AuthUnavailableError } from "@/lib/auth";

export const runtime = "nodejs";

const RequestBody = z.object({
  inviteCode: z.string().min(4).max(64),
});

export async function POST(req: NextRequest) {
  if (!featureFlags.simSwapOnDemand) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }

  let user;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json(
        { error: "auth_unavailable" },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: z.infer<typeof RequestBody>;
  try {
    body = RequestBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supa = createServiceClient();
  if (!supa) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const { data: invite, error: fetchErr } = await supa
    .from("sim_swap_beta_invites")
    .select("invite_code, redeemed_by, redeemed_at")
    .eq("invite_code", body.inviteCode)
    .maybeSingle();

  if (fetchErr) {
    logger.error("invite fetch failed", { error: fetchErr });
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!invite) {
    return NextResponse.json({ error: "invite_not_found" }, { status: 404 });
  }

  // Idempotent: same user re-redeeming their own code = success.
  if (invite.redeemed_by === user.id) {
    return NextResponse.json({ ok: true, alreadyRedeemed: true });
  }
  if (invite.redeemed_by && invite.redeemed_by !== user.id) {
    return NextResponse.json({ error: "invite_already_used" }, { status: 410 });
  }

  const { error: updateErr } = await supa
    .from("sim_swap_beta_invites")
    .update({
      redeemed_by: user.id,
      redeemed_at: new Date().toISOString(),
    })
    .eq("invite_code", body.inviteCode)
    .is("redeemed_by", null); // race-safe — UPDATE only matches if still unclaimed

  if (updateErr) {
    logger.error("invite redeem failed", { error: updateErr });
    return NextResponse.json({ error: "redeem_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
