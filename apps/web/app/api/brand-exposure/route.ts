import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { brandNormalize } from "@askarthur/shopfront-glue";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";

import { logEvent } from "@/lib/analytics-events";
import { resolveWatchlistBrand } from "@/lib/clone-watch/resolve-brand";

/**
 * Public "Is your brand being cloned?" teaser (Wave 2 PR 2.2).
 *
 * Returns a SCRAPE-PROOF masked exposure summary for a brand: resolves the input
 * to a watch-list entry by EXACT set membership (arbitrary input / SQL wildcards
 * resolve to nothing), rate-limits per IP, then reads the masked teaser from the
 * v203 SECURITY DEFINER RPC (adjudicated rows only, <=5 masked examples). No
 * email needed for the teaser; the FULL unmasked CSV stays behind the work-email
 * gate in /api/clone-list-request (embedded on the page as the conversion step).
 *
 * Gated FF_BRAND_EXPOSURE.
 */

export const dynamic = "force-dynamic";

const Schema = z.object({ brand: z.string().min(1).max(255) });

export async function POST(req: NextRequest) {
  if (!featureFlags.brandExposure) {
    return NextResponse.json({ error: "not_enabled" }, { status: 503 });
  }

  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rl = await checkFormRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // EXACT resolution — the anti-scrape gate. "%%"/"a%"/unknown → not monitored.
  const entry = resolveWatchlistBrand(parsed.data.brand);
  if (!entry) {
    return NextResponse.json({ monitored: false, count: 0, examples: [] });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const { data, error } = await supabase.rpc("brand_exposure_summary", {
    p_brand_normalized: brandNormalize(entry.brand),
  });
  if (error) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : null;
  const count = row?.detected_count ?? 0;

  // Coordinated-campaign teaser (v235): "X of these lookalikes trace to Y
  // coordinated actors." Scrape-proof — counts only, never domain names.
  // Gated FF_CLONE_CAMPAIGNS + graceful (empty) when campaign_key isn't stamped.
  let campaigns: { count: number; largest: number } | null = null;
  if (featureFlags.cloneCampaigns) {
    const { data: campData } = await supabase.rpc("clone_campaigns_for_brand", {
      p_brand_normalized: brandNormalize(entry.brand),
      p_since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      p_until: new Date().toISOString(),
    });
    const camps = (campData ?? []) as Array<{ domain_count?: number }>;
    if (camps.length > 0) {
      campaigns = {
        count: camps.length,
        largest: Math.max(...camps.map((c) => c.domain_count ?? 0)),
      };
    }
  }

  // Funnel telemetry — measure exposure checks so leads attribute back to Clone
  // Watch. Server-emitted, metadata only (no PII); fire-and-forget.
  void logEvent({
    eventType: "brand_exposure_checked",
    eventProps: {
      brand: entry.brand,
      monitored: true,
      count,
      campaignCount: campaigns?.count ?? 0,
    },
    path: "/brand-exposure",
  });

  return NextResponse.json({
    monitored: true,
    brand: entry.brand,
    count,
    earliest: row?.earliest ?? null,
    examples: row?.examples ?? [],
    campaigns,
  });
}
