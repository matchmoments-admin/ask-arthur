import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";

import { AuthUnavailableError, getSupabaseUserOrThrow } from "@/lib/auth";

const JoinSchema = z.object({
  inviteCode: z.string().trim().min(16).max(64),
});

export async function POST(req: NextRequest) {
  if (!featureFlags.familyPlan) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const authClient = await createAuthServerClient();
  if (!authClient) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
  }

  let user;
  try {
    user = await getSupabaseUserOrThrow(authClient);
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json(
        { error: "auth_unavailable", retryAfterSec: 30 },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Per-user attempt limit (fail-closed in production) — invite codes are
  // bearer secrets, so guessing must be bounded per account, not just per IP.
  const rate = await checkFormRateLimit(`family-join:${user.id}`);
  if (!rate.allowed) {
    const retryAfter = rate.resetAt
      ? Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000))
      : 60;
    return NextResponse.json(
      { error: rate.message ?? "Too many attempts. Please try again later." },
      {
        status: rate.reason === "store_unavailable" ? 503 : 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
  }

  const parsed = JoinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { inviteCode } = parsed.data;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Find the pending invite. One generic 404 for unknown / used / expired /
  // wrong-recipient, so the response doesn't reveal which codes exist.
  const invalid = () =>
    NextResponse.json({ error: "Invalid or expired invite" }, { status: 404 });
  const { data: member, error: findError } = await supabase
    .from("family_members")
    .select("id, group_id, email, expires_at")
    .eq("invite_code", inviteCode)
    .is("joined_at", null)
    .maybeSingle();

  if (findError || !member) return invalid();
  if (!member.expires_at || Date.parse(member.expires_at) <= Date.now()) {
    return invalid();
  }
  // An invite addressed to an email can only be redeemed by that account.
  if (
    member.email &&
    member.email.trim().toLowerCase() !== (user.email ?? "").trim().toLowerCase()
  ) {
    return invalid();
  }

  // Redeem atomically: the joined_at IS NULL guard means two concurrent
  // redemptions of one code cannot both succeed.
  const { data: joined, error: updateError } = await supabase
    .from("family_members")
    .update({
      user_id: user.id,
      joined_at: new Date().toISOString(),
      invite_code: null,
    })
    .eq("id", member.id)
    .is("joined_at", null)
    .select("id");

  if (updateError) {
    logger.error("Failed to join family group", { error: updateError });
    return NextResponse.json({ error: "Join failed" }, { status: 500 });
  }
  if (!joined || joined.length === 0) return invalid();

  // Log activity
  await supabase.from("family_activity_log").insert({
    group_id: member.group_id,
    member_id: member.id,
    event_type: "member_joined",
    summary: `${user.email} joined the family group`,
  });

  return NextResponse.json({ joined: true });
}
