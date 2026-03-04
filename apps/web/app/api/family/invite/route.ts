import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

export async function POST(req: NextRequest) {
  if (!featureFlags.familyPlan) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const authClient = await createAuthServerClient();
  if (!authClient) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
  }

  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { groupId: string; email: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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

  // Generate invite code
  const inviteCode = crypto.randomUUID().slice(0, 8).toUpperCase();

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
