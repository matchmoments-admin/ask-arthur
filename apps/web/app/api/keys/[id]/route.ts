import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { getOrg } from "@/lib/org";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth check via lib/auth (5s timeout + AuthUnavailableError) — incident 2026-05-09.
  let user;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json(
        { error: "Authentication temporarily unavailable" },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const keyId = parseInt(id, 10);
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
  }

  // Service client + an explicit ownership check. The update is not made with
  // the user's own session: key state is server-owned (v322 revokes column
  // writes on api_keys from authenticated), so this route decides who may
  // revoke — the key's owner, or an active owner/admin of the key's org.
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { data: key, error: lookupError } = await supabase
    .from("api_keys")
    .select("id, user_id, org_id")
    .eq("id", keyId)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }

  let allowed = !!key && key.user_id === user.id;
  if (key && !allowed && key.org_id) {
    const org = await getOrg(user.id);
    allowed =
      !!org &&
      org.orgId === key.org_id &&
      (org.memberRole === "owner" || org.memberRole === "admin");
  }
  if (!key || !allowed) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("api_keys")
    .update({ is_active: false })
    .eq("id", keyId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to revoke key" },
      { status: 500 }
    );
  }

  return NextResponse.json({ revoked: true });
}
