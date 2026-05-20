// GET /api/shop-check/[id] — poll a Deep Shop Check.
//
// The client polls this after POST /api/shop-check while the
// shop-signal-enrich Inngest function runs ABN + WHOIS + APIVoid and writes
// the result back onto the shop_checks row. Mirrors /api/media/status.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { createServiceClient } from "@askarthur/supabase/server";
import {
  ShopCheckEnrichmentSchema,
  type ShopCheckResult,
} from "@askarthur/types";

export async function GET(
  _req: NextRequest,
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
