import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  confirm: z.literal("DELETE"),
});

// APL right-to-erasure endpoint. Deletes the auth.users row, which cascades
// to user_profiles (ON DELETE CASCADE) and family_groups the user owns.
// Subscriptions, api_keys, push_tokens, family_memberships, and org_members
// are either SET NULL or CASCADE per their respective migrations — the delete
// below relies on those existing constraints; nothing is hand-rolled here.
//
// Public threat intelligence submitted by the user (scam_reports keyed by a
// bcrypt reporter_hash, not user_id) is retained for community safety. This
// is surfaced in the response so users can correct their expectations.
export async function POST(req: NextRequest) {
  const auth = await createAuthServerClient();
  if (!auth) {
    return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
  }

  const { data: userResp, error: userErr } = await auth.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "confirmation_required", message: 'Send {"confirm":"DELETE"} to proceed.' },
      { status: 400 },
    );
  }

  const userId = userResp.user.id;
  const svc = createServiceClient();
  if (!svc) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  try {
    // Revoke api_keys explicitly so a leaked bearer token can't outlive the account.
    await svc
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("revoked_at", null);

    // Detach from orgs before auth delete so the CASCADE doesn't strand the
    // organization without its last owner in a half-state.
    await svc.from("org_members").delete().eq("user_id", userId);

    // Admin delete on auth.users cascades to user_profiles and family_groups.
    const { error: delErr } = await svc.auth.admin.deleteUser(userId);
    if (delErr) throw new Error(delErr.message);

    await auth.auth.signOut();

    logger.info("user-delete complete", { userId });

    return NextResponse.json({
      ok: true,
      message: "Account deleted.",
      note: "Any scam reports you submitted remain in the public threat feed for community safety; they are not linked to your identity.",
    });
  } catch (err) {
    logger.error("user-delete failed", { userId, error: String(err) });
    return NextResponse.json({ error: "delete_failed", message: String(err) }, { status: 500 });
  }
}
