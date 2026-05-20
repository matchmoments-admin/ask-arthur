// POST /api/shop-check — start a user-initiated Deep Shop Check.
//
// Triggered when the user clicks "Run a deeper shop check" in the result
// card. Creates a shop_checks row (placeholder score), emits
// shop.check.requested.v1, and returns the row id for the client to poll
// via GET /api/shop-check/[id].
//
// See docs/adr/0008-shop-signal-deep-check-user-initiated.md — this is the
// user-initiated model that supersedes the #321 auto-fire spec.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkShopSignalRateLimit } from "@askarthur/utils/rate-limit";
import { sha256Hex } from "@askarthur/utils/hash";
import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";
import { normalizeURL } from "@askarthur/scam-engine/url-normalize";
import { isPrivateURL } from "@askarthur/scam-engine/safebrowsing";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { SHOP_CHECK_REQUESTED_EVENT } from "@askarthur/scam-engine/inngest/events";
import { ReferrerSourceSchema } from "@askarthur/types";

const BodySchema = z.object({
  url: z.string().min(1).max(2048),
  commerceFlags: z.array(z.string().max(64)).max(50).optional(),
  referrerSource: ReferrerSourceSchema.optional(),
});

export async function POST(req: NextRequest) {
  if (!featureFlags.shopSignal) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid request",
      },
      { status: 400 },
    );
  }

  const norm = normalizeURL(parsed.data.url);
  if (!norm) {
    return NextResponse.json(
      { error: "validation_error", message: "Not a valid http(s) URL" },
      { status: 400 },
    );
  }
  if (isPrivateURL(norm.normalized)) {
    return NextResponse.json(
      { error: "validation_error", message: "URL not allowed" },
      { status: 400 },
    );
  }

  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const limit = await checkShopSignalRateLimit("sc_deep_check", ip);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          limit.reason === "store_unavailable"
            ? "service_unavailable"
            : "rate_limited",
        message: limit.message ?? "Too many requests.",
      },
      {
        status: limit.reason === "store_unavailable" ? 503 : 429,
        headers: limit.resetAt
          ? {
              "Retry-After": String(
                Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)),
              ),
            }
          : undefined,
      },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "service_unavailable", message: "Storage unavailable" },
      { status: 503 },
    );
  }

  const urlHashHex = await sha256Hex(norm.normalized);
  // Idempotency key — caller-supplied header, else url+day so a repeat click
  // on the same shop the same day reuses the row instead of re-spending.
  const dayBucket = new Date().toISOString().slice(0, 10);
  const idempotencyKey =
    req.headers.get("Idempotency-Key")?.slice(0, 255) ||
    `shop-check:${urlHashHex}:${dayBucket}`;

  // Re-click guard — if a row already exists for this idempotency key,
  // return it unchanged so a re-click never resets a completed row's score.
  const existing = await supabase
    .from("shop_checks")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.data?.id) {
    return NextResponse.json(
      { id: existing.data.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const commerceFlags = parsed.data.commerceFlags ?? [];
  const signal = {
    isCommerce: true,
    commerceFlags,
    generatedAt: new Date().toISOString(),
    ...(parsed.data.referrerSource && {
      referrerSource: parsed.data.referrerSource,
    }),
    deepCheck: { status: "queued" },
  };

  const { data: shopCheckId, error: rpcError } = await supabase.rpc(
    "upsert_shop_check",
    {
      p_idempotency_key: idempotencyKey,
      p_url_hash: urlHashHex,
      p_url_normalized: norm.normalized,
      p_verdict: "UNCERTAIN", // placeholder — enrichment sets the real value
      p_composite_score: 0, // placeholder — enrichment sets the real score
      p_signal: signal,
      p_request_id: null,
      p_source_surface: "web",
      p_referrer_source: parsed.data.referrerSource ?? null,
    },
  );

  if (rpcError || !shopCheckId) {
    logger.error("shop-check: upsert_shop_check failed", {
      error: rpcError?.message,
    });
    return NextResponse.json(
      { error: "service_unavailable", message: "Could not start the check" },
      { status: 503 },
    );
  }

  try {
    await inngest.send({
      name: SHOP_CHECK_REQUESTED_EVENT,
      id: `shop-check:${shopCheckId}`,
      data: {
        shopCheckId,
        url: norm.normalized,
        commerceFlags,
        ...(parsed.data.referrerSource && {
          referrerSource: parsed.data.referrerSource,
        }),
      },
    });
  } catch (err) {
    // The row exists in "queued" — the client poll will surface a stuck
    // state rather than a hard failure. Log loudly.
    logger.error("shop-check: inngest emit failed", {
      shopCheckId,
      error: String(err),
    });
  }

  return NextResponse.json(
    { id: shopCheckId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
