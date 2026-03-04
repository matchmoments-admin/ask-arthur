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

  let body: { inviteCode: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Find pending invite
  const { data: member, error: findError } = await supabase
    .from("family_members")
    .select("id, group_id")
    .eq("invite_code", body.inviteCode)
    .is("joined_at", null)
    .single();

  if (findError || !member) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 404 });
  }

  // Join the group
  const { error: updateError } = await supabase
    .from("family_members")
    .update({
      user_id: user.id,
      joined_at: new Date().toISOString(),
      invite_code: null,
    })
    .eq("id", member.id);

  if (updateError) {
    logger.error("Failed to join family group", { error: updateError });
    return NextResponse.json({ error: "Join failed" }, { status: 500 });
  }

  // Log activity
  await supabase.from("family_activity_log").insert({
    group_id: member.group_id,
    member_id: member.id,
    event_type: "member_joined",
    summary: `${user.email} joined the family group`,
  });

  return NextResponse.json({ joined: true });
}
