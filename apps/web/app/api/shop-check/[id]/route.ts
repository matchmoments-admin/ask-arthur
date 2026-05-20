// GET /api/shop-check/[id] — poll a Deep Shop Check.
//
// The client polls this after POST /api/shop-check while the
// shop-signal-enrich Inngest function runs ABN + WHOIS + APIVoid and writes
// the result back onto the shop_checks row. Mirrors /api/media/status.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkShopSignalRateLimit } from "@askarthur/utils/rate-limit";
import { createServiceClient } from "@askarthur/supabase/server";
import {
  ShopCheckEnrichmentSchema,
  type ShopCheckResult,
} from "@askarthur/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.shopSignal) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid id" },
      { status: 400 },
    );
  }

  // Poll-rate guard — throttles a script hammering a known uuid. failMode
  // "open": this is a cheap indexed PK read, so a Redis outage must fail
  // toward letting the poll through, never toward breaking a live check.
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const limit = await checkShopSignalRateLimit("sc_poll", ip, "open");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: limit.message ?? "Too many requests." },
      {
        status: 429,
        headers: limit.resetAt
          ? {
              "Retry-After": String(
                Math.max(
                  1,
                  Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000),
                ),
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

  const { data: row, error } = await supabase
    .from("shop_checks")
    .select("id, url_normalized, signal")
    .eq("id", id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json(
      { error: "not_found", message: "Shop check not found" },
      { status: 404 },
    );
  }

  const deepCheck = (row.signal as { deepCheck?: unknown } | null)?.deepCheck;
  const enrichment = ShopCheckEnrichmentSchema.safeParse(deepCheck);

  const result: ShopCheckResult = {
    id: row.id,
    url: row.url_normalized,
    ...(enrichment.success ? enrichment.data : { status: "processing" }),
  };

  const isTerminal = result.status === "complete" || result.status === "error";

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": isTerminal ? "private, max-age=60" : "no-store",
    },
  });
}
