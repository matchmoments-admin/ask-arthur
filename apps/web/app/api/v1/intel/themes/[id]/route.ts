// GET /api/v1/intel/themes/[id] — single theme detail with member posts
//
// Returns the named theme plus up to 50 contributing reddit_post_intel rows
// (joined to feed_items for the source URL + Reddit permalink). The id can
// be either the UUID primary key or the URL-friendly slug.

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Look up by either UUID or slug — caller-friendly.
  const lookupCol = UUID_RE.test(id) ? "id" : "slug";
  const { data: theme, error: themeErr } = await supabase
    .from("reddit_intel_themes")
    .select(
      "id, slug, title, narrative, modus_operandi, representative_brands, member_count, signal_strength, first_seen_at, last_seen_at, wow_delta_pct",
    )
    .eq(lookupCol, id)
    .eq("is_active", true)
    .maybeSingle();

  if (themeErr) {
    logger.error("v1/intel/themes detail lookup failed", {
      id,
      error: themeErr.message,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!theme) {
    return NextResponse.json({ error: "Theme not found" }, { status: 404 });
  }

  // Member posts — join via theme_id. Capped at 50 to bound response size;
  // pagination not implemented yet (defer until a customer asks).
  const { data: members } = await supabase
    .from("reddit_post_intel")
    .select(
      "id, intent_label, confidence, narrative_summary, brands_impersonated, country_hints, processed_at, feed_items(url, source_url)",
    )
    .eq("theme_id", theme.id as string)
    .order("processed_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    theme: {
      id: theme.id,
      slug: theme.slug,
      title: theme.title,
      narrative: theme.narrative,
      modusOperandi: theme.modus_operandi,
      representativeBrands: theme.representative_brands ?? [],
      memberCount: theme.member_count,
      signalStrength: theme.signal_strength,
      firstSeenAt: theme.first_seen_at,
      lastSeenAt: theme.last_seen_at,
      wowDeltaPct: theme.wow_delta_pct,
    },
    members: (members ?? []).map((m) => {
      const feedItem = m.feed_items as { url?: string; source_url?: string } | null;
      return {
        id: m.id,
        intentLabel: m.intent_label,
        confidence: m.confidence,
        narrativeSummary: m.narrative_summary,
        brandsImpersonated: m.brands_impersonated ?? [],
        countryHints: m.country_hints ?? [],
        processedAt: m.processed_at,
        sourceUrl: feedItem?.source_url ?? feedItem?.url ?? null,
      };
    }),
    memberSampleSize: (members ?? []).length,
  });
}
