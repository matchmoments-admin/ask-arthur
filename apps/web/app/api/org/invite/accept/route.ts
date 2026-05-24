import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { checkOrgInviteAcceptRateLimit } from "@askarthur/utils/rate-limit";
import { getUser } from "@/lib/auth";
import { AuthUnavailableError } from "@/lib/auth";
import { logger } from "@askarthur/utils/logger";

const AcceptSchema = z.object({
  token: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json(
        { error: "Authentication service temporarily unavailable" },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
  if (!user) {
    return NextResponse.json({ error: "Please sign in to accept this invitation" }, { status: 401 });
  }

  // Rate limit BEFORE the DB lookup so an attacker can't probe tokens
  // unboundedly. Identifier is user.id, not IP, so accounts can't bypass by
  // rotating IPs. 10/hr (see checkOrgInviteAcceptRateLimit) is well above
  // legit retry rates.
  const rl = await checkOrgInviteAcceptRateLimit(user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: rl.message ?? "Too many attempts. Try again later." },
      {
        status: 429,
        headers: rl.resetAt
          ? { "Retry-After": Math.max(1, Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)).toString() }
          : undefined,
      },
    );
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

  // Email-binding: the invitation token is only valid for the email the
  // org admin entered. Without this, anyone who guesses or steals a token
  // (CSRF on the invite email, shoulder-surf, a phished forward) can join
  // the org as the invited role. Compare case-insensitively because Supabase
  // stores emails verbatim from the admin entry, which is often title-cased,
  // while user.email is whatever the signup flow recorded. Do NOT echo the
  // expected email back in the response — that would let a logged-in
  // attacker probe membership by token.
  const invitedEmail = (invitation.email ?? "").trim().toLowerCase();
  const userEmail = (user.email ?? "").trim().toLowerCase();
  if (!invitedEmail || !userEmail || invitedEmail !== userEmail) {
    logger.warn("org invite email mismatch", {
      userId: user.id,
      invitationId: invitation.id,
    });
    return NextResponse.json(
      { error: "This invitation was sent to a different email address" },
      { status: 403 },
    );
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
