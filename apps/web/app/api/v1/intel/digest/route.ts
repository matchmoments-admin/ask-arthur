// GET /api/v1/intel/digest — last N days of daily summaries
//
// Returns the rolled-up narrative + stats for each day in the window.
// ?days defaults to 7, capped at 30. Useful for B2B subscribers building
// their own dashboards or ingesting into SIEM-style tooling.

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
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "7"), 1), 30);
  const audience = searchParams.get("audience") ?? "internal";
  if (!["internal", "public", "b2b", "b2c"].includes(audience)) {
    return NextResponse.json(
      { error: "audience must be one of: internal, public, b2b, b2c" },
      { status: 400 },
    );
  }

  const sinceDate = new Date(Date.now() - days * 86_400_000);
  const sinceCohort = sinceDate.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("reddit_intel_daily_summary")
    .select(
      "cohort_date, lead_narrative, emerging_threats, brand_watchlist, stats, posts_classified, model_version, prompt_version",
    )
    .eq("audience", audience)
    .is("country_code", null)
    .gte("cohort_date", sinceCohort)
    .order("cohort_date", { ascending: false });

  if (error) {
    logger.error("v1/intel/digest failed", { error: error.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({
    days,
    audience,
    cohortStart: sinceCohort,
    cohorts: (data ?? []).map((d) => ({
      cohortDate: d.cohort_date,
      leadNarrative: d.lead_narrative,
      emergingThreats: d.emerging_threats ?? [],
      brandWatchlist: d.brand_watchlist ?? [],
      stats: d.stats ?? {},
      postsClassified: d.posts_classified,
      modelVersion: d.model_version,
      promptVersion: d.prompt_version,
    })),
    count: (data ?? []).length,
  });
}
