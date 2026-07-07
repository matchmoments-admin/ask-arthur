// Weekly aggregation of Reddit-intel data for the Mon weekly email.
//
// Two paths, chosen by the FF_REDDIT_INTEL_WEEKLY_SYNTHESIS flag:
//
//   1. Synthesis (preferred, Track B) — one Sonnet call over THIS week's
//      reddit_post_intel cohort produces 3-5 "emerging this week" stories,
//      persisted to reddit_intel_weekly_digest. Dynamic-by-construction; the
//      email is a different read every week. See
//      docs/plans/weekly-intel-dynamic.md + packages/scam-engine
//      reddit-intel/weekly-synthesis.ts.
//
//   2. Theme-table fallback — when synthesis is off/unavailable/braked.
//      Ranks themes by members-ADDED-this-week (velocity, Track A) rather
//      than cumulative member_count, so even the fallback reflects the week
//      rather than all-time size.
//
// The email template (WeeklyIntelDigest) consumes a single WeeklyRedditIntel
// shape from either path — the synthesis path fills `href: null`/`signalLabel`
// so stories render as plain (non-linked) headlines with a "new/rising" tag,
// while the fallback fills `href` with the durable /intel/themes/[slug] link.

import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { synthesizeWeeklyIntel } from "@askarthur/scam-engine/reddit-intel/weekly-synthesis";
import { withUtm } from "@/lib/utm";

const EMAIL_UTM = { source: "email", campaign: "weekly-intel-digest", medium: "email" };

export interface WeeklyEmergingTheme {
  /** UUID (theme) or synthetic `story-N` id. */
  id: string;
  /** URL-friendly slug; null for synthesis stories. */
  slug: string | null;
  title: string;
  narrative: string | null;
  /** This-week report count (velocity for themes, weeklyReportCount for stories). */
  memberCount: number;
  representativeBrands: string[];
  /** Deep link to a durable theme page, or null for synthesis stories. */
  href: string | null;
  /** "New this week" / "Rising" chip, or null. */
  signalLabel: string | null;
}

export interface WeeklyRedditIntel {
  weekStart: string;
  weekEnd: string;
  totalPostsClassified: number;
  latestLeadNarrative: string;
  topCategories: Array<{ label: string; count: number }>;
  topBrands: Array<{ brand: string; mentionCount: number }>;
  emergingThemes: WeeklyEmergingTheme[];
  scamOfTheWeekQuote: { text: string; speakerRole: string } | null;
  modelVersion: string;
  promptVersion: string;
}

const DAYS = 7;

const NOVELTY_LABEL: Record<string, string | null> = {
  new: "New this week",
  rising: "Rising",
  ongoing: null,
};

/**
 * Entry point for the weekly-email cron. Prefers the synthesis path when the
 * flag is on, falling back to the velocity-ranked theme table otherwise or
 * when synthesis yields nothing (empty cohort, brake engaged, DB down).
 */
export async function getWeeklyIntelForEmail(): Promise<WeeklyRedditIntel | null> {
  if (featureFlags.redditIntelWeeklySynthesis) {
    try {
      const digest = await synthesizeWeeklyIntel();
      if (digest && digest.stories.length > 0) {
        return {
          weekStart: digest.weekStart,
          weekEnd: digest.weekEnd,
          totalPostsClassified: digest.cohortPostCount,
          latestLeadNarrative: digest.stories[0]?.narrative ?? "",
          topCategories: digest.topCategories,
          topBrands: digest.topBrands,
          emergingThemes: digest.stories.map((s) => ({
            id: `story-${s.rank}`,
            slug: null,
            title: s.title,
            narrative: s.narrative,
            memberCount: s.weeklyReportCount,
            representativeBrands: s.representativeBrands,
            href: null,
            signalLabel: NOVELTY_LABEL[s.noveltySignal] ?? null,
          })),
          scamOfTheWeekQuote: digest.scamOfTheWeek,
          modelVersion: digest.modelVersion,
          promptVersion: digest.promptVersion,
        };
      }
      logger.info("weekly-intel: synthesis flag on but no digest — falling back to themes");
    } catch (err) {
      // Synthesis is best-effort for the email — a Claude/DB hiccup must not
      // block the Monday send. Fall through to the theme-table path.
      logger.warn("weekly-intel: synthesis failed, falling back to themes", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return getWeeklyRedditIntelFromThemes();
}

/**
 * Theme-table fallback. Aggregates the last 7 days of daily summaries for
 * stats, and ranks emerging themes by members-added-this-week (velocity)
 * rather than cumulative size.
 */
export async function getWeeklyRedditIntelFromThemes(): Promise<WeeklyRedditIntel | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const weekStartDate = new Date(Date.now() - DAYS * 86_400_000);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = new Date().toISOString().slice(0, 10);

  // 1. Daily summaries in window → stats.
  const { data: dailies, error: dailiesErr } = await supabase
    .from("reddit_intel_daily_summary")
    .select("cohort_date, lead_narrative, stats, posts_classified, model_version, prompt_version")
    .eq("audience", "internal")
    .is("country_code", null)
    .gte("cohort_date", weekStart)
    .lte("cohort_date", weekEnd)
    .order("cohort_date", { ascending: false });

  if (dailiesErr || !dailies || dailies.length === 0) return null;

  const catTotals: Record<string, number> = {};
  const brandTotals: Record<string, number> = {};
  let totalPosts = 0;
  for (const d of dailies) {
    const stats = d.stats as {
      totalPosts?: number;
      topCategories?: Record<string, number>;
      topBrands?: Record<string, number>;
    } | null;
    if (!stats) continue;
    totalPosts += stats.totalPosts ?? 0;
    for (const [k, v] of Object.entries(stats.topCategories ?? {}))
      catTotals[k] = (catTotals[k] ?? 0) + v;
    for (const [k, v] of Object.entries(stats.topBrands ?? {}))
      brandTotals[k] = (brandTotals[k] ?? 0) + v;
  }

  const topCategories = Object.entries(catTotals)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const topBrands = Object.entries(brandTotals)
    .map(([brand, mentionCount]) => ({ brand, mentionCount }))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 5);

  // 2. Track A velocity — count posts that JOINED each theme this week.
  const { data: recentPosts } = await supabase
    .from("reddit_post_intel")
    .select("theme_id")
    .gte("processed_at", weekStartDate.toISOString())
    .not("theme_id", "is", null)
    .limit(5000);

  const velocity: Record<string, number> = {};
  for (const p of recentPosts ?? []) {
    const id = p.theme_id as string | null;
    if (id) velocity[id] = (velocity[id] ?? 0) + 1;
  }
  const topThemeIds = Object.entries(velocity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  let emergingThemes: WeeklyEmergingTheme[] = [];
  if (topThemeIds.length > 0) {
    const { data: themes } = await supabase
      .from("reddit_intel_themes")
      .select("id, slug, title, narrative, representative_brands")
      .in("id", topThemeIds)
      .neq("title", "Pending naming");

    const byId = new Map((themes ?? []).map((t) => [t.id as string, t]));
    // Preserve velocity order and attach the this-week count.
    emergingThemes = topThemeIds
      .map((id): WeeklyEmergingTheme | null => {
        const t = byId.get(id);
        if (!t) return null;
        const slug = (t.slug as string | null) ?? null;
        return {
          id,
          slug,
          title: t.title as string,
          narrative: (t.narrative as string | null) ?? null,
          memberCount: velocity[id] ?? 0,
          representativeBrands: (t.representative_brands as string[]) ?? [],
          href: withUtm(`https://askarthur.au/intel/themes/${slug ?? id}`, EMAIL_UTM),
          signalLabel: null,
        };
      })
      .filter((t): t is WeeklyEmergingTheme => t !== null);
  }

  // 3. Scam of the week — most recent high-confidence quote in window.
  const { data: quotes } = await supabase
    .from("reddit_intel_quotes")
    .select("quote_text, speaker_role, confidence")
    .gte("created_at", weekStartDate.toISOString())
    .gte("confidence", 0.7)
    .order("created_at", { ascending: false })
    .limit(1);

  const scamOfTheWeekQuote =
    quotes && quotes.length > 0
      ? {
          text: quotes[0].quote_text as string,
          speakerRole: (quotes[0].speaker_role as string) ?? "unknown",
        }
      : null;

  return {
    weekStart,
    weekEnd,
    totalPostsClassified: totalPosts,
    latestLeadNarrative: dailies[0].lead_narrative as string,
    topCategories,
    topBrands,
    emergingThemes,
    scamOfTheWeekQuote,
    modelVersion: (dailies[0].model_version as string) ?? "",
    promptVersion: (dailies[0].prompt_version as string) ?? "",
  };
}
