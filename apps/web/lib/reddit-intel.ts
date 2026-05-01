// Read-side helpers for the Reddit Intelligence dashboard widget.
// Uses createServiceClient() because the dashboard pages run as authenticated
// admin users — there's no per-user RLS scoping needed for reading aggregate
// scam-intel data, and direct service-role reads are fastest.

import { createServiceClient } from "@askarthur/supabase/server";

export interface RedditIntelSummary {
  cohortDate: string;
  leadNarrative: string;
  emergingThreats: Array<{
    title: string;
    summary: string;
    samplePostId?: number;
    indicatorCount: number;
  }>;
  brandWatchlist: Array<{ brand: string; mentionCount: number }>;
  stats: {
    totalPosts: number;
    topCategories: Record<string, number>;
    topBrands: Record<string, number>;
  };
  postsClassified: number;
  modelVersion: string;
  promptVersion: string;
}

export interface RedditIntelTheme {
  id: string;
  slug: string;
  title: string;
  narrative: string | null;
  modusOperandi: string | null;
  representativeBrands: string[];
  memberCount: number;
  signalStrength: "noise" | "weak" | "strong";
  lastSeenAt: string;
  firstSeenAt: string;
}

/**
 * Latest internal daily summary (the canonical 200-300 word lead narrative).
 * Returns null when no row exists for today — the widget renders an empty
 * state in that case instead of throwing, so a flag flip with no data
 * doesn't 500 the threats page.
 */
export async function getLatestRedditIntelSummary(): Promise<RedditIntelSummary | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("reddit_intel_daily_summary")
    .select(
      "cohort_date, lead_narrative, emerging_threats, brand_watchlist, stats, posts_classified, model_version, prompt_version",
    )
    .eq("audience", "internal")
    .is("country_code", null)
    .order("cohort_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    cohortDate: data.cohort_date as string,
    leadNarrative: data.lead_narrative as string,
    emergingThreats: (data.emerging_threats as RedditIntelSummary["emergingThreats"]) ?? [],
    brandWatchlist: (data.brand_watchlist as RedditIntelSummary["brandWatchlist"]) ?? [],
    stats: (data.stats as RedditIntelSummary["stats"]) ?? {
      totalPosts: 0,
      topCategories: {},
      topBrands: {},
    },
    postsClassified: (data.posts_classified as number) ?? 0,
    modelVersion: (data.model_version as string) ?? "",
    promptVersion: (data.prompt_version as string) ?? "",
  };
}

/**
 * Top N active themes ordered by member_count desc. "Pending naming" themes
 * are filtered out — they're useful internally but ugly in the UI.
 */
export async function getActiveRedditIntelThemes(
  limit = 8,
): Promise<RedditIntelTheme[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("reddit_intel_themes")
    .select(
      "id, slug, title, narrative, modus_operandi, representative_brands, member_count, signal_strength, last_seen_at, first_seen_at",
    )
    .eq("is_active", true)
    .neq("title", "Pending naming")
    .order("member_count", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    narrative: (r.narrative as string | null) ?? null,
    modusOperandi: (r.modus_operandi as string | null) ?? null,
    representativeBrands: (r.representative_brands as string[]) ?? [],
    memberCount: (r.member_count as number) ?? 0,
    signalStrength: r.signal_strength as RedditIntelTheme["signalStrength"],
    lastSeenAt: r.last_seen_at as string,
    firstSeenAt: r.first_seen_at as string,
  }));
}

/**
 * Freshness probe — when did the daily classifier last run? Used by the
 * widget header to show "last updated X hours ago" + amber/red badges
 * if the pipeline has stalled.
 */
export async function getRedditIntelFreshness(): Promise<{
  latestProcessedAt: string | null;
  hoursStale: number | null;
}> {
  const supabase = createServiceClient();
  if (!supabase) return { latestProcessedAt: null, hoursStale: null };

  const { data, error } = await supabase
    .from("reddit_post_intel")
    .select("processed_at")
    .order("processed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return { latestProcessedAt: null, hoursStale: null };

  const latest = data.processed_at as string;
  const hoursStale = (Date.now() - new Date(latest).getTime()) / 3_600_000;
  return { latestProcessedAt: latest, hoursStale };
}
