// GET /api/v1/intel/themes — list active Reddit-intel themes
//
// Returns the catalogue of named scam themes Ask Arthur is tracking.
// Filter via ?signal=weak|strong, ?since=ISO date, ?limit=1-100.
// Gated by featureFlags.redditIntelB2bApi (returns 503 when off, after
// API-key validation so unauthorised callers still get 401 not 503).

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
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20"), 1), 100);
  const signal = searchParams.get("signal");
  const since = searchParams.get("since");

  let q = supabase
    .from("reddit_intel_themes")
    .select(
      "id, slug, title, narrative, modus_operandi, representative_brands, member_count, signal_strength, first_seen_at, last_seen_at, wow_delta_pct",
    )
    .eq("is_active", true)
    .neq("title", "Pending naming")
    .order("member_count", { ascending: false })
    .limit(limit);

  if (signal === "weak" || signal === "strong" || signal === "noise") {
    q = q.eq("signal_strength", signal);
  }
  if (since) {
    // Reject non-ISO dates rather than silently ignoring — caller-facing
    // contract should fail loudly on malformed input.
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json(
        { error: "since must be an ISO 8601 date or datetime" },
        { status: 400 },
      );
    }
    q = q.gte("last_seen_at", sinceDate.toISOString());
  }

  const { data, error } = await q;
  if (error) {
    logger.error("v1/intel/themes list failed", { error: error.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({
    themes: (data ?? []).map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      narrative: r.narrative,
      modusOperandi: r.modus_operandi,
      representativeBrands: r.representative_brands ?? [],
      memberCount: r.member_count,
      signalStrength: r.signal_strength,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      wowDeltaPct: r.wow_delta_pct,
    })),
    count: (data ?? []).length,
    filters: { limit, signal: signal ?? null, since: since ?? null },
  });
}
