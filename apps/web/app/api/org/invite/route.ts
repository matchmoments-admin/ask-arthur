import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { buildOrgInviteEmail } from "@/lib/email/org-invite";
import { checkOrgInviteSendRateLimit } from "@askarthur/utils/rate-limit";
import { ASSIGNABLE_ORG_ROLES } from "@/lib/org-roles";

const InviteSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  role: z.enum(ASSIGNABLE_ORG_ROLES),
});

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getOrg(user.id);
  if (!org || !["owner", "admin"].includes(org.memberRole)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Validate before charging the send quota, so a malformed or refused request
  // doesn't use up the inviter's allowance.
  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email, role } = parsed.data;

  // Only the owner grants admin — the same rule the members PATCH enforces.
  if (role === "admin" && org.memberRole !== "owner") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Per-inviter quota: each call sends an email from the Ask Arthur sender.
  const rl = await checkOrgInviteSendRateLimit(user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: rl.message ?? "Too many invitations sent. Try again later." },
      {
        status: 429,
        headers: rl.resetAt
          ? { "Retry-After": Math.max(1, Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)).toString() }
          : undefined,
      },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Check if user is already a member
  const { data: existing } = await supabase
    .from("org_members")
    .select("id")
    .eq("org_id", org.orgId)
    .eq("user_id", (
      await supabase.from("user_profiles").select("id").eq("billing_email", email).single()
    ).data?.id ?? "00000000-0000-0000-0000-000000000000")
    .single();

  if (existing) {
    return NextResponse.json({ error: "User is already a member of this organization" }, { status: 409 });
  }

  // Check for existing pending invitation
  const { data: pendingInvite } = await supabase
    .from("org_invitations")
    .select("id")
    .eq("org_id", org.orgId)
    .eq("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (pendingInvite) {
    return NextResponse.json({ error: "An invitation is already pending for this email" }, { status: 409 });
  }

  // Generate secure token
  const rawToken = crypto.randomUUID() + crypto.randomUUID();
  const tokenData = new TextEncoder().encode(rawToken);
  const hashBuffer = await crypto.subtle.digest("SHA-256", tokenData);
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error: insertError } = await supabase.from("org_invitations").insert({
    org_id: org.orgId,
    email,
    role,
    token: tokenHash,
    invited_by: user.id,
  });

  if (insertError) {
    return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 });
  }

  // Send invitation email (fire-and-forget)
  const inviteUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au"}/invite/${rawToken}`;

  if (process.env.RESEND_API_KEY) {
    const inviteEmail = buildOrgInviteEmail({ orgName: org.orgName, role, inviteUrl });
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "Ask Arthur <brendan@askarthur.au>",
        to: [email],
        subject: inviteEmail.subject,
        html: inviteEmail.html,
      }),
    })
      .then((r) => {
        // Cost telemetry — this route sends via a raw fetch (not the shared
        // @/lib/resend helpers, which log internally), so it was the one Resend
        // send invisible to /admin/costs. Log only on a successful dispatch.
        if (r.ok) {
          logCost({
            feature: "org_invite",
            provider: "resend",
            operation: "emails.send",
            units: 1,
            unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
          });
        }
      })
      .catch(() => {});
  }

  return NextResponse.json(
    { success: true, message: `Invitation sent to ${email}` },
    { status: 201 }
  );
}
