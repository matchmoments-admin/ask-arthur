import { NextResponse } from "next/server";
import { createAuthServerClient } from "@askarthur/supabase/server-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { AuthUnavailableError, getSupabaseUserOrThrow } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// APL-compliant data export. Returns a JSON bundle of everything linked to
// the caller's auth uid. Service client is used for the actual reads so RLS
// quirks (service-role-only tables the user legitimately owns rows in, e.g.
// cost_telemetry) don't silently omit data from the export.
export async function GET() {
  const auth = await createAuthServerClient();
  if (!auth) {
    return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
  }

  let supabaseUser;
  try {
    supabaseUser = await getSupabaseUserOrThrow(auth);
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json(
        { error: "auth_unavailable", retryAfterSec: 30 },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
  if (!supabaseUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Shadow the original `userResp` shape so the export bundle below reads the same.
  const userResp = { user: supabaseUser };
  const userId = userResp.user.id;

  const svc = createServiceClient();
  if (!svc) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  try {
    const [
      profile,
      apiKeys,
      subscriptions,
      pushTokens,
      familyGroups,
      familyMemberships,
      orgMemberships,
      costTelemetry,
    ] = await Promise.all([
      svc.from("user_profiles").select("*").eq("id", userId).maybeSingle(),
      svc.from("api_keys")
        .select("id, name, tier, daily_limit, created_at, last_used_at, revoked_at")
        .eq("user_id", userId),
      svc.from("subscriptions")
        .select("id, tier, status, billing_provider, current_period_end, created_at, updated_at")
        .eq("user_id", userId),
      svc.from("push_tokens")
        .select("id, platform, region, active, last_seen, created_at")
        .eq("user_id", userId),
      svc.from("family_groups").select("*").eq("owner_id", userId),
      svc.from("family_members")
        .select("id, group_id, email, role, created_at")
        .eq("user_id", userId),
      svc.from("org_members")
        .select("id, org_id, role, status, accepted_at")
        .eq("user_id", userId),
      svc.from("cost_telemetry")
        .select("id, feature, provider, operation, units, estimated_cost_usd, created_at")
        .eq("user_id", userId)
        .limit(10_000),
    ]);

    const bundle = {
      exportedAt: new Date().toISOString(),
      user: {
        id: userId,
        email: userResp.user.email,
        createdAt: userResp.user.created_at,
      },
      profile: profile.data ?? null,
      apiKeys: apiKeys.data ?? [],
      subscriptions: subscriptions.data ?? [],
      pushTokens: pushTokens.data ?? [],
      familyGroups: familyGroups.data ?? [],
      familyMemberships: familyMemberships.data ?? [],
      orgMemberships: orgMemberships.data ?? [],
      costTelemetry: costTelemetry.data ?? [],
      notes: [
        "Submitted scam reports are publicly shared threat intelligence and are not linked to your account.",
        "Deleted api_keys store only a SHA-256 hash; the plaintext key is never retained.",
      ],
    };

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="askarthur-export-${userId}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("user-export failed", { userId, error: String(err) });
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }
}
