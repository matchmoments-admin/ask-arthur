import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser } from "@/lib/auth";

const AcceptSchema = z.object({
  token: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to accept this invitation" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = AcceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const { token } = parsed.data;

  // Hash the raw token to look up in the database
  const tokenData = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", tokenData);
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Find the invitation
  const { data: invitation, error: lookupError } = await supabase
    .from("org_invitations")
    .select("id, org_id, email, role, expires_at, accepted_at")
    .eq("token", tokenHash)
    .single();

  if (lookupError || !invitation) {
    return NextResponse.json({ error: "Invalid or expired invitation" }, { status: 404 });
  }

  if (invitation.accepted_at) {
    return NextResponse.json({ error: "This invitation has already been accepted" }, { status: 409 });
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ error: "This invitation has expired" }, { status: 410 });
  }

  // Check if user is already a member
  const { data: existingMember } = await supabase
    .from("org_members")
    .select("id")
    .eq("org_id", invitation.org_id)
    .eq("user_id", user.id)
    .single();

  if (existingMember) {
    return NextResponse.json({ error: "You are already a member of this organization" }, { status: 409 });
  }

  // Add user as org member
  const { error: memberError } = await supabase.from("org_members").insert({
    org_id: invitation.org_id,
    user_id: user.id,
    role: invitation.role,
    invited_by: user.id,
    status: "active",
    accepted_at: new Date().toISOString(),
  });

  if (memberError) {
    return NextResponse.json({ error: "Failed to join organization" }, { status: 500 });
  }

  // Mark invitation as accepted
  await supabase
    .from("org_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  // Get org name for response
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", invitation.org_id)
    .single();

  return NextResponse.json({
    success: true,
    orgName: org?.name ?? "Organization",
    role: invitation.role,
  });
}
