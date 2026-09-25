import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

import { AuthUnavailableError, getSupabaseUserOrThrow } from "@/lib/auth";

const InviteBody = z.object({
  groupId: z.string().min(1),
  email: z.string().trim().toLowerCase().email().max(320),
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Every invite is addressed to a real email: join only redeems a code for
  // the account whose confirmed email matches, so an empty/invalid address
  // must never reach the table (it would make the code redeemable by anyone).
  const parsed = InviteBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid groupId and email are required" }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Verify user is admin of this group
  const { data: group } = await supabase
    .from("family_groups")
    .select("id, max_members")
    .eq("id", body.groupId)
    .eq("owner_id", user.id)
    .single();

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Check member count
  const { count } = await supabase
    .from("family_members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", body.groupId);

  if ((count ?? 0) >= group.max_members) {
    return NextResponse.json({ error: "Group is full" }, { status: 400 });
  }

  // 128-bit, URL-safe invite code (was 32 bits from a UUID prefix). The row's
  // expires_at defaults to now() + 7 days (v323); join enforces it.
  const inviteCode = randomBytes(16).toString("base64url");

  const { data, error } = await supabase
    .from("family_members")
    .insert({
      group_id: body.groupId,
      email: body.email,
      invite_code: inviteCode,
    })
    .select()
    .single();

  if (error) {
    logger.error("Failed to create invite", { error });
    return NextResponse.json({ error: "Invite failed" }, { status: 500 });
  }

  return NextResponse.json({ member: data, inviteCode }, { status: 201 });
}
