// GET /api/v1/intel/quotes — recent extracted PII-scrubbed quotes
//
// Returns up to 50 ≤140-char quotes from victim Reddit reports, with their
// associated theme tag and confidence. Each quote is verbatim from the
// source post but scrubbed of identifying info (no usernames, locations,
// employer names, or other PII per the source brief's safe-harbour stance).
//
// Filter via ?since (ISO date), ?role=victim|scammer|witness, ?min_confidence
// (default 0.6), ?limit (default 25, max 50).

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  if (auth.rateLimited) {
    return NextResponse.json(
      { error: "Daily API limit exceeded. Resets at midnight UTC." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  if (!featureFlags.redditIntelB2bApi) {
    return NextResponse.json(
      { error: "Reddit Intel API not enabled on this deployment" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "25"), 1), 50);
  const role = searchParams.get("role");
  const minConfidence = Math.min(
    Math.max(parseFloat(searchParams.get("min_confidence") ?? "0.6"), 0),
    1,
  );
  const since = searchParams.get("since");

  let q = supabase
    .from("reddit_intel_quotes")
    .select(
      "id, quote_text, speaker_role, theme_tag, confidence, created_at, feed_item_id",
    )
    .gte("confidence", minConfidence)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (role && ["victim", "scammer", "witness", "unknown"].includes(role)) {
    q = q.eq("speaker_role", role);
  }
  if (since) {
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json(
        { error: "since must be an ISO 8601 date or datetime" },
        { status: 400 },
      );
    }
    q = q.gte("created_at", sinceDate.toISOString());
  }

  const { data, error } = await q;
  if (error) {
    logger.error("v1/intel/quotes failed", { error: error.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({
    quotes: (data ?? []).map((r) => ({
      id: r.id,
      text: r.quote_text,
      speakerRole: r.speaker_role,
      themeTag: r.theme_tag,
      confidence: r.confidence,
      createdAt: r.created_at,
      feedItemId: r.feed_item_id,
    })),
    count: (data ?? []).length,
    filters: {
      limit,
      role: role ?? null,
      minConfidence,
      since: since ?? null,
    },
  });
}
