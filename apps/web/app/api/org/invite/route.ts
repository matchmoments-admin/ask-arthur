import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser } from "@/lib/auth";
import { getOrg } from "@/lib/org";

const InviteSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  role: z.enum(["admin", "compliance_officer", "fraud_analyst", "developer", "viewer"]),
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

  const body = await req.json();
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email, role } = parsed.data;

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
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "Ask Arthur <noreply@askarthur.au>",
        to: [email],
        subject: `You've been invited to join ${org.orgName} on Ask Arthur`,
        html: `
          <div style="font-family: 'Public Sans', sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1B2A4A; padding: 24px 28px; border-radius: 8px 8px 0 0;">
              <p style="color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin: 0;">Ask Arthur</p>
            </div>
            <div style="background: #fff; padding: 28px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px;">
              <h1 style="color: #1B2A4A; font-size: 24px; margin: 0 0 16px;">You've been invited</h1>
              <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                You've been invited to join <strong>${org.orgName}</strong> on Ask Arthur as a <strong>${role.replace("_", " ")}</strong>.
              </p>
              <p style="margin: 24px 0;">
                <a href="${inviteUrl}" style="background: #0D9488; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Accept Invitation</a>
              </p>
              <p style="color: #64748B; font-size: 14px;">This invitation expires in 7 days.</p>
              <hr style="border-color: #E2E8F0; margin: 24px 0;" />
              <p style="color: #94A3B8; font-size: 12px;">Ask Arthur | ABN 72 695 772 313 | Sydney, Australia</p>
            </div>
          </div>
        `,
      }),
    }).catch(() => {});
  }

  return NextResponse.json(
    { success: true, message: `Invitation sent to ${email}` },
    { status: 201 }
  );
}
