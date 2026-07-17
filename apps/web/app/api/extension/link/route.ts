import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Redis } from "@upstash/redis";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { LINK_TOKEN_PREFIX } from "../_lib/link-token";

// Consume a link token (minted by the install via /link-token) and associate
// the install with the logged-in user. Called by the /extension/link page.
//
// Security properties:
// - Session-authed (getUser), NOT extension-signed: the browser tab, not the
//   extension, proves who the human is.
// - Token is atomically GETDEL'd — single-use even under concurrent posts.
// - An install already linked to a DIFFERENT user is a 409, never a silent
//   re-link: re-linking would transfer any pro entitlement to the new user,
//   so it must be an explicit unlink-first flow (not built yet).

const LinkSchema = z.object({
  token: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "malformed token"),
});

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!featureFlags.extensionBilling) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
    }

    let user;
    try {
      user = await getUser();
    } catch (err) {
      if (err instanceof AuthUnavailableError) {
        return NextResponse.json(
          { error: "auth_unavailable" },
          { status: 503, headers: { "Retry-After": "30" } },
        );
      }
      throw err;
    }
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = LinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const redis = getRedis();
    const supabase = createServiceClient();
    if (!redis || !supabase) {
      return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
    }

    // Atomic single-use consume.
    const installId = await redis.getdel<string>(`${LINK_TOKEN_PREFIX}${parsed.data.token}`);
    if (!installId) {
      return NextResponse.json(
        {
          error: "invalid_or_expired_token",
          message: "This link has expired — open 'Link account' in the extension again.",
        },
        { status: 401 },
      );
    }

    const { data: install } = await supabase
      .from("extension_installs")
      .select("install_id, revoked")
      .eq("install_id", installId)
      .maybeSingle();
    if (!install || install.revoked) {
      return NextResponse.json({ error: "unknown_install" }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from("extension_subscriptions")
      .select("user_id, tier")
      .eq("install_id", installId)
      .maybeSingle();

    if (existing?.user_id && existing.user_id !== user.id) {
      logger.warn("extension link refused: install linked to another account", {
        install_id_prefix: installId.slice(0, 8),
      });
      return NextResponse.json(
        {
          error: "already_linked",
          message: "This extension install is linked to a different account.",
        },
        { status: 409 },
      );
    }

    const { error: upsertErr } = await supabase.from("extension_subscriptions").upsert(
      {
        install_id: installId,
        user_id: user.id,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "install_id" },
    );
    if (upsertErr) {
      logger.error("extension link upsert failed", { error: upsertErr.message });
      return NextResponse.json({ error: "link_failed" }, { status: 500 });
    }

    return NextResponse.json({
      linked: true,
      tier: existing?.tier ?? "free",
      // Safe to return: the caller just proved control of this install via
      // the single-use token, and needs the id for the Pro checkout call.
      installId,
    });
  } catch (err) {
    logger.error("extension link error", { error: String(err) });
    return NextResponse.json({ error: "link_failed" }, { status: 500 });
  }
}
