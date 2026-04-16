import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser } from "@/lib/auth";
import { getOrg } from "@/lib/org";

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

export async function PATCH(req: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getOrg(user.id);
  if (!org || !["owner", "admin"].includes(org.memberRole)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json();
  const { memberId, role, status } = body as {
    memberId: number;
    role?: string;
    status?: string;
  };

  if (!memberId) {
    return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const updates: Record<string, string> = {};
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
