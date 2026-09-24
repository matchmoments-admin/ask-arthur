import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { ASSIGNABLE_ORG_ROLES } from "@/lib/org-roles";

export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getOrg(user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { data: members, error } = await supabase
    .from("org_members")
    .select("id, user_id, role, status, created_at, accepted_at")
    .eq("org_id", org.orgId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }

  // Enrich with user profile data
  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("id, display_name, billing_email")
    .in("id", userIds);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p])
  );

  const enriched = (members ?? []).map((m) => ({
    ...m,
    display_name: profileMap.get(m.user_id)?.display_name ?? null,
    email: profileMap.get(m.user_id)?.billing_email ?? null,
  }));

  return NextResponse.json({ data: enriched });
}

/** Roles an admin/owner may assign. Never `owner` — ownership transfer is not a
 *  role edit. Mirrors the invite route's enum. */
const AssignableRole = z.enum(ASSIGNABLE_ORG_ROLES);

const PatchBody = z
  .object({
    memberId: z.number().int().positive(),
    role: AssignableRole.optional(),
    status: z.enum(["active", "deactivated"]).optional(),
  })
  .refine((b) => b.role !== undefined || b.status !== undefined, {
    message: "role or status is required",
  });

export async function PATCH(req: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getOrg(user.id);
  if (!org || !["owner", "admin"].includes(org.memberRole)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }
  const { memberId, role, status } = parsed.data;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { data: target, error: targetError } = await supabase
    .from("org_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("org_id", org.orgId)
    .maybeSingle();
  if (targetError) {
    return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // The owner's row is never edited here, nobody edits their own membership,
  // and only the owner manages admins (grant, change, or deactivate).
  if (target.role === "owner" || target.user_id === user.id) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  if (
    org.memberRole !== "owner" &&
    (target.role === "admin" || role === "admin")
  ) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const updates: { role?: string; status?: string } = {};
  if (role) updates.role = role;
  if (status) updates.status = status;

  const { error } = await supabase
    .from("org_members")
    .update(updates)
    .eq("id", memberId)
    .eq("org_id", org.orgId);

  if (error) {
    return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
